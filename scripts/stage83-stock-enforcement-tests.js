#!/usr/bin/env node
"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const Stock=require("../kutadgu-stock.js");
const Prod=require("../admin-catalog-productivity.js");

const root=path.join(__dirname,"..");
let failed=0;
function test(name,fn){
  try{fn();console.log("PASS",name)}
  catch(err){failed++;console.error("FAIL",name,err&&err.message)}
}
function read(rel){return fs.readFileSync(path.join(root,rel),"utf8")}
function functionBody(source,name){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const match=source.match(new RegExp(String.raw`create or replace function ${escaped}\([\s\S]*?\$\$;`,"i"));
  assert.ok(match,"missing function "+name);
  return match[0];
}

const sql=read("STAGE83_STOCK_ENFORCEMENT.sql");
const setup=read("SUPABASE_SETUP.sql");
const stage80=read("STAGE80_MEMBER_ORDER_INTEGRITY.sql");
const stage65=read("STAGE65_PRICE_HISTORY.sql");
const shop=read("shop.js");
const admin=read("admin.js");
const member=read("member.js");
const cfg=read("supabase-config.js");
const appCfg=read("app-config.js");
const pkg=read("package.json");
const workflow=read(".github/workflows/stage10-regression.yml");
const POST_CHECK_MARK="-- READ-ONLY POST-CHECK (manual). Do NOT run as part of apply.";
const apply=sql.split(POST_CHECK_MARK)[0];
const checks=sql.split(POST_CHECK_MARK)[1]||"";
const sqlCreate=functionBody(sql,"public.create_member_order");
const setupCreate=functionBody(setup,"public.create_member_order");
const delta=functionBody(sql,"public.kutadgu_apply_order_stock_delta");
const transition=functionBody(sql,"public.kutadgu_orders_stock_transition");
const preventDel=functionBody(sql,"public.kutadgu_prevent_delete_committed_book");

const COMMITTED=new Set(["confirmed","processing","shipped","completed"]);
function mergeItems(items){
  const map=new Map();
  (items||[]).forEach(item=>{
    const id=Number(item.book_id);
    const qty=Number(item.qty);
    map.set(id,(map.get(id)||0)+qty);
  });
  return [...map.entries()].sort((a,b)=>a[0]-b[0]).map(([book_id,qty])=>({book_id,qty}));
}
function simulateTransition(order,books,nextStatus){
  const oldC=!!order.stock_committed;
  const newC=COMMITTED.has(nextStatus);
  const nextOrder=Object.assign({},order,{status:nextStatus});
  if(oldC===newC){
    nextOrder.stock_committed=oldC;
    return {ok:true,order:nextOrder,books:Object.assign({},books),changed:false};
  }
  const lines=mergeItems(order.items);
  const nextBooks=Object.assign({},books);
  if(!oldC&&newC){
    for(const line of lines){
      if(!Object.prototype.hasOwnProperty.call(nextBooks,line.book_id)){
        return {ok:false,error:"book_not_found",order,books};
      }
      if(nextBooks[line.book_id]<line.qty){
        return {ok:false,error:"insufficient_stock",order,books};
      }
    }
    for(const line of lines)nextBooks[line.book_id]-=line.qty;
    nextOrder.stock_committed=true;
    return {ok:true,order:nextOrder,books:nextBooks,changed:true};
  }
  for(const line of lines){
    if(!Object.prototype.hasOwnProperty.call(nextBooks,line.book_id)){
      return {ok:false,error:"book_not_found",order,books};
    }
    nextBooks[line.book_id]+=line.qty;
  }
  nextOrder.stock_committed=false;
  return {ok:true,order:nextOrder,books:nextBooks,changed:true};
}

test("manual reviewed apply only and does not execute from CI",()=>{
  assert.match(sql,/MANUAL \/ REVIEWED APPLY ONLY/);
  assert.doesNotMatch(pkg,/STAGE83_STOCK_ENFORCEMENT/);
  assert.doesNotMatch(workflow,/STAGE83_STOCK_ENFORCEMENT/);
  assert.doesNotMatch(workflow,/\bpsql\b/);
  assert.doesNotMatch(apply,/\bTRUNCATE\b/i);
  assert.doesNotMatch(apply,/DROP TABLE/i);
  assert.doesNotMatch(apply,/DROP POLICY/i);
  assert.doesNotMatch(apply,/CREATE POLICY/i);
});

test("preflight aborts on NULL stock and ambiguous historical orders only on first apply",()=>{
  assert.match(apply,/stock IS NULL/);
  assert.match(apply,/Historical inventory state is ambiguous/);
  assert.match(apply,/IF NOT v_has_committed_col THEN/);
  assert.match(apply,/status IS DISTINCT FROM 'cancelled'/);
});

test("stock is finalized NOT NULL with default 0 and nonnegative CHECK",()=>{
  assert.match(apply,/ALTER COLUMN stock SET NOT NULL/);
  assert.match(apply,/ALTER COLUMN stock SET DEFAULT 0/);
  assert.match(apply,/CHECK \(stock >= 0\)/);
  assert.doesNotMatch(apply,/COLUMN stock_status/i);
  assert.doesNotMatch(apply,/ADD COLUMN[\s\S]{0,40}stock_status/i);
  assert.match(setup,/stock integer not null default 0 check \(stock >= 0\)/i);
  assert.match(setup,/alter column stock set not null/i);
  assert.doesNotMatch(setup,/stock_status/);
});

test("stock_committed column default false; historical cancelled is not rewritten",()=>{
  assert.match(apply,/ADD COLUMN IF NOT EXISTS stock_committed boolean NOT NULL DEFAULT false/i);
  assert.doesNotMatch(apply.split("kutadgu_apply_order_stock_delta")[0],/\bUPDATE\s+public\.orders\b/i);
  assert.doesNotMatch(apply.split("kutadgu_apply_order_stock_delta")[0],/\bUPDATE\s+public\.books\b/i);
  assert.match(setup,/stock_committed boolean not null default false/i);
});

test("committed vs not-committed status model is explicit",()=>{
  assert.match(apply,/NOT COMMITTED: prepared, cancelled/);
  assert.match(apply,/COMMITTED:     confirmed, processing, shipped, completed/);
  assert.match(transition,/NEW\.status IN \('confirmed', 'processing', 'shipped', 'completed'\)/);
  assert.match(transition,/NEW\.stock_committed := v_old_committed/);
  assert.match(transition,/kutadgu_apply_order_stock_delta\(OLD\.items, -1\)/);
  assert.match(transition,/kutadgu_apply_order_stock_delta\(OLD\.items, 1\)/);
});

test("clients cannot forge stock_committed",()=>{
  assert.match(transition,/NEW\.stock_committed := true/);
  assert.match(transition,/NEW\.stock_committed := false/);
  assert.match(transition,/v_old_committed := coalesce\(OLD\.stock_committed, false\)/);
  assert.doesNotMatch(admin,/\.update\(\{status:nextStatus,stock_committed/);
  assert.match(admin,/\.update\(\{status:nextStatus\}\)/);
});

test("row lock strategy is deterministic SELECT FOR UPDATE by book id",()=>{
  assert.match(delta,/ORDER BY b\.id/i);
  assert.match(delta,/FOR UPDATE OF b/i);
  assert.match(delta,/ARRAY\(SELECT DISTINCT unnest\(v_ids\) ORDER BY 1\)/);
  assert.match(setup,/for update of b/i);
  assert.match(setup,/order by b\.id/i);
});

test("duplicate item IDs are merged before locking",()=>{
  assert.match(delta,/v_qty_map \? v_id_text/);
  assert.match(delta,/v_merged := \(v_qty_map ->> v_id_text\)::integer \+ v_qty/);
});

test("insufficient stock raises without decrementing other books in a failed statement",()=>{
  assert.match(delta,/RAISE EXCEPTION 'insufficient_stock'/i);
  assert.match(delta,/stock \+ \(p_sign \* v_qty\) >= 0/);
  assert.match(delta,/IF v_locked <> v_needed THEN/);
});

test("create_member_order checks stock but does not decrement",()=>{
  [sqlCreate,setupCreate].forEach(fn=>{
    assert.match(fn,/insufficient_stock/);
    assert.match(fn,/v_book\.stock < v_qty/);
    assert.match(fn,/'prepared'/);
    assert.doesNotMatch(fn,/kutadgu_apply_order_stock_delta/);
    assert.doesNotMatch(fn,/FOR UPDATE/i);
    assert.doesNotMatch(fn,/stock\s*=\s*stock\s*-/);
    assert.doesNotMatch(fn,/p_sign/);
  });
  assert.doesNotMatch(functionBody(stage80,"public.create_member_order"),/insufficient_stock/);
});

test("SECURITY DEFINER hygiene for stock functions",()=>{
  [delta,transition,preventDel,sqlCreate].forEach(fn=>{
    assert.match(fn,/SECURITY DEFINER/i);
    assert.match(fn,/SET search_path = public/i);
    assert.doesNotMatch(fn,/EXECUTE\s+'/i);
    assert.doesNotMatch(fn,/EXECUTE\s+IMMEDIATE/i);
  });
  assert.match(apply,/REVOKE ALL ON FUNCTION public\.kutadgu_apply_order_stock_delta\(jsonb, integer\) FROM PUBLIC/i);
  assert.match(apply,/REVOKE ALL ON FUNCTION public\.kutadgu_apply_order_stock_delta\(jsonb, integer\) FROM anon/i);
  assert.match(apply,/REVOKE ALL ON FUNCTION public\.kutadgu_apply_order_stock_delta\(jsonb, integer\) FROM authenticated/i);
  assert.match(apply,/REVOKE ALL ON FUNCTION public\.kutadgu_orders_stock_transition\(\) FROM authenticated/i);
  assert.match(apply,/GRANT EXECUTE ON FUNCTION public\.create_member_order[\s\S]*TO authenticated/i);
  assert.match(apply,/REVOKE EXECUTE ON FUNCTION public\.create_member_order[\s\S]*FROM anon/i);
});

test("book delete protection blocks committed inventory restoration holes",()=>{
  assert.match(preventDel,/book_has_committed_stock/);
  assert.match(preventDel,/o\.stock_committed = true/);
  assert.match(apply,/BEFORE DELETE ON public\.books/);
  assert.match(admin,/isBookHasCommittedStockError/);
  assert.match(admin,/جەزملەنگەن زاكازدا تۇتۇلغان/);
});

test("price-history still ignores stock-only book updates",()=>{
  assert.match(stage65,/IF OLD\.price IS NOT DISTINCT FROM NEW\.price THEN/);
  assert.match(stage65,/AFTER UPDATE OF price ON public\.books/);
  assert.match(stage65,/WHEN \(OLD\.price IS DISTINCT FROM NEW\.price\)/);
  assert.doesNotMatch(apply,/book_price_history/);
  assert.doesNotMatch(apply,/log_book_price_change/);
});

test("1 prepared -> confirmed deducts exact qty",()=>{
  const order={status:"prepared",stock_committed:false,items:[{book_id:1,qty:2}]};
  const out=simulateTransition(order,{1:10},"confirmed");
  assert.equal(out.ok,true);
  assert.equal(out.books[1],8);
  assert.equal(out.order.stock_committed,true);
});

test("2 prepared -> processing also deducts",()=>{
  const out=simulateTransition({status:"prepared",stock_committed:false,items:[{book_id:1,qty:1}]},{1:5},"processing");
  assert.equal(out.books[1],4);
  assert.equal(out.order.stock_committed,true);
});

test("3 confirmed -> processing does NOT deduct again",()=>{
  const out=simulateTransition({status:"confirmed",stock_committed:true,items:[{book_id:1,qty:2}]},{1:8},"processing");
  assert.equal(out.changed,false);
  assert.equal(out.books[1],8);
});

test("4 processing -> shipped does NOT deduct again",()=>{
  const out=simulateTransition({status:"processing",stock_committed:true,items:[{book_id:1,qty:2}]},{1:8},"shipped");
  assert.equal(out.changed,false);
  assert.equal(out.books[1],8);
});

test("5 shipped -> completed does NOT deduct again",()=>{
  const out=simulateTransition({status:"shipped",stock_committed:true,items:[{book_id:1,qty:2}]},{1:8},"completed");
  assert.equal(out.changed,false);
  assert.equal(out.books[1],8);
});

test("6 confirmed -> cancelled restores exact qty",()=>{
  const out=simulateTransition({status:"confirmed",stock_committed:true,items:[{book_id:1,qty:2}]},{1:8},"cancelled");
  assert.equal(out.books[1],10);
  assert.equal(out.order.stock_committed,false);
});

test("7 confirmed -> prepared restores exact qty",()=>{
  const out=simulateTransition({status:"confirmed",stock_committed:true,items:[{book_id:1,qty:2}]},{1:8},"prepared");
  assert.equal(out.books[1],10);
});

test("8 cancelled -> confirmed re-deducts if available",()=>{
  const out=simulateTransition({status:"cancelled",stock_committed:false,items:[{book_id:1,qty:2}]},{1:10},"confirmed");
  assert.equal(out.books[1],8);
});

test("9 repeated cancelled does NOT double restore",()=>{
  const first=simulateTransition({status:"confirmed",stock_committed:true,items:[{book_id:1,qty:2}]},{1:8},"cancelled");
  const second=simulateTransition(first.order,first.books,"cancelled");
  assert.equal(second.changed,false);
  assert.equal(second.books[1],10);
});

test("10 insufficient stock rejects atomically",()=>{
  const out=simulateTransition({status:"prepared",stock_committed:false,items:[{book_id:1,qty:6}]},{1:5},"confirmed");
  assert.equal(out.ok,false);
  assert.equal(out.error,"insufficient_stock");
  assert.equal(out.books[1],5);
});

test("11 two confirmations cannot oversell the same book",()=>{
  const a={status:"prepared",stock_committed:false,items:[{book_id:1,qty:3}]};
  const b={status:"prepared",stock_committed:false,items:[{book_id:1,qty:3}]};
  const first=simulateTransition(a,{1:5},"confirmed");
  assert.equal(first.ok,true);
  assert.equal(first.books[1],2);
  const second=simulateTransition(b,first.books,"confirmed");
  assert.equal(second.ok,false);
  assert.equal(second.error,"insufficient_stock");
  assert.equal(second.books[1],2);
});

test("12 multi-book order is all-or-nothing",()=>{
  const out=simulateTransition({
    status:"prepared",stock_committed:false,
    items:[{book_id:1,qty:2},{book_id:2,qty:9}]
  },{1:10,2:1},"confirmed");
  assert.equal(out.ok,false);
  assert.equal(out.books[1],10);
  assert.equal(out.books[2],1);
});

test("13 duplicate item IDs are merged defensively",()=>{
  const lines=mergeItems([{book_id:1,qty:2},{book_id:1,qty:3}]);
  assert.deepStrictEqual(lines,[{book_id:1,qty:5}]);
  const out=simulateTransition({status:"prepared",stock_committed:false,items:[{book_id:1,qty:2},{book_id:1,qty:3}]},{1:10},"confirmed");
  assert.equal(out.books[1],5);
});

test("14 stock never becomes negative in the model",()=>{
  const out=simulateTransition({status:"prepared",stock_committed:false,items:[{book_id:1,qty:1}]},{1:0},"confirmed");
  assert.equal(out.ok,false);
  assert.equal(out.books[1],0);
});

test("15 existing cancelled historical order does not alter stock",()=>{
  const out=simulateTransition({status:"cancelled",stock_committed:false,items:[{book_id:1,qty:4}]},{1:12},"cancelled");
  assert.equal(out.changed,false);
  assert.equal(out.books[1],12);
});

test("16 forged stock_committed is ignored when status group is unchanged",()=>{
  const order={status:"prepared",stock_committed:false,items:[{book_id:1,qty:1}]};
  const out=simulateTransition(order,{1:4},"prepared");
  assert.equal(out.order.stock_committed,false);
  assert.match(transition,/NEW\.stock_committed := v_old_committed/);
});

test("production storefront gate is ON",()=>{
  assert.match(cfg,/KUTADGU_STOCK_ENFORCEMENT = true/);
  assert.doesNotMatch(cfg,/KUTADGU_STOCK_ENFORCEMENT = false/);
  assert.match(appCfg,/stockEnforcement:true/);
  assert.doesNotMatch(appCfg,/stockEnforcement:false/);
  const zero=Stock.storefrontStockInfo({stock:0},{stockEnforcement:true});
  assert.equal(zero.canBuy,false);
  assert.equal(zero.key,"out");
  const low=Stock.storefrontStockInfo({stock:3},{stockEnforcement:true});
  assert.equal(low.key,"low");
  assert.equal(low.qty,3);
  const inn=Stock.storefrontStockInfo({stock:4},{stockEnforcement:true});
  assert.equal(inn.key,"in");
  assert.equal(inn.canBuy,true);
});

test("cart qty is capped and stale qty cannot build a member order",()=>{
  assert.match(shop,/if\(Number\.isFinite\(stock\.qty\)\)next=Math\.min\(next,stock\.qty\)/);
  assert.match(shop,/function clampCartQuantitiesToStock\(\)/);
  assert.match(shop,/سېۋەتتىكى سان نۆۋەتتىكى ئامبارغا ماسلاشتۇرۇلدى/);
  assert.match(shop,/سېۋەتتىكى سان نۆۋەتتىكى ئامباردىن ئېشىپ كەتتى/);
  assert.match(member,/insufficient_stock/);
});

test("guest WhatsApp does not create a database reservation",()=>{
  const wa=shop.slice(shop.indexOf("async function orderWithWhatsApp(){"),shop.indexOf("function setupCheckout(){"));
  assert.match(wa,/savePreparedOrderHistory/);
  assert.match(shop,/if\(typeof member\?\.getUser==="function"&&!member\.getUser\(\)\)return \{saved:false,reason:"not_signed_in"\}/);
  assert.doesNotMatch(shop,/from\("orders"\)\.insert/);
  assert.doesNotMatch(member,/from\("orders"\)\.insert/);
});

test("Admin insufficient-stock UX and read-only committed flag",()=>{
  assert.match(admin,/insufficientStockOrderUpdateMessage/);
  assert.match(admin,/ئامبار سانى يەتمىدى\. زاكاز ھالىتى ئۆزگەرتىلمىدى/);
  assert.match(admin,/orderStockCommittedLabel/);
  assert.match(admin,/ئامبار تۇتۇلدى/);
  assert.match(admin,/stock_committed/);
  assert.match(admin,/requireConfiguredStock/);
  const created=Prod.buildQuickEditPatch({title:"A",source:"universal.html",stock:""},{presentBookCols:new Set(["stock"])});
  assert.equal(created.ok,false);
  const ok=Prod.buildQuickEditPatch({title:"A",source:"universal.html",stock:"0"},{presentBookCols:new Set(["stock"])});
  assert.equal(ok.ok,true);
  assert.equal(ok.patch.stock,0);
});

test("no stock_status persistence reappears",()=>{
  assert.doesNotMatch(apply,/ADD COLUMN(?: IF NOT EXISTS)? stock_status/i);
  assert.match(admin,/delete out\.stock_status/);
  const bulk=Prod.buildBulkPatch("stock_status",{stock_status:"out_of_stock"},{presentBookCols:new Set(["stock_status"]),stockStatusSupported:true});
  assert.equal(bulk.ok,false);
});

test("AAL2/admin order update path is unchanged except error mapping",()=>{
  assert.match(admin,/decideAdminOrderStatusUpdate/);
  assert.match(admin,/isAal2OrderUpdateError/);
  assert.doesNotMatch(apply,/DROP POLICY IF EXISTS "aal2 required to update orders"/i);
  assert.doesNotMatch(apply,/DROP POLICY IF EXISTS "admin can update orders"/i);
});

test("read-only post-check is documented",()=>{
  assert.match(checks,/is_nullable/);
  assert.match(checks,/stock_committed/);
  assert.match(checks,/FOR UPDATE/);
  assert.match(checks,/anon execute/);
  assert.match(checks,/books = 8, orders = 4/);
  assert.doesNotMatch(checks,/^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|GRANT|REVOKE)\b/im);
});

test("shop.js cache pins bumped for Phase 2",()=>{
  assert.match(read("index.html"),/shop\.js\?v=114/);
  assert.match(read("book.html"),/shop\.js\?v=113/);
  assert.match(shop,/app-config\.js\?v=4/);
});

if(failed){
  console.error("\n"+failed+" failed");
  process.exit(1);
}
console.log("\nAll Stage 83 stock enforcement tests passed");
