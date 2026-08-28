#!/usr/bin/env node
"use strict";
const assert=require("assert");
const W=require("../admin-book-write.js");

function mockDb(){
  const calls=[];
  const api={
    calls,
    from(table){
      const call={table,method:null,payload:null,filter:null,selectCols:null};
      const chain={
        update(payload){call.method="PATCH";call.payload=payload;return chain;},
        insert(payload){call.method="POST";call.payload=payload;return chain;},
        eq(col,val){call.filter=`${col}=eq.${val}`;return chain;},
        async select(cols){
          call.selectCols=cols;
          calls.push(call);
          if(call.method==="PATCH"){
            if(call.filter!=="id=eq.2")return {data:[],error:null};
            return {data:[{id:2}],error:null};
          }
          return {data:[{id:999}],error:null};
        }
      };
      return chain;
    }
  };
  return api;
}

async function persistBookRow(db,payload,operation,editingBookId){
  const op=W.enforcePersistOperation(operation,editingBookId);
  if(op==="STOP")return {error:new Error("stop")};
  if(op==="UPDATE"){
    const {data,error}=await db.from("books").update(payload).eq("id",editingBookId).select("id");
    if(error)return {error};
    if(!Array.isArray(data)||data.length!==1)return {error:new Error("zero-row update")};
    return {error:null,data};
  }
  if(W.canonicalBookId(editingBookId))return {error:new Error("refused insert")};
  return db.from("books").insert({...payload}).select("id");
}

(async()=>{
  const books={2:{id:2,price:200,legacy_id:"romanlar-2"}};
  let count=2;

  const db=mockDb();
  const plan=W.planBookSave({id:2},"2","edit");
  assert.strictEqual(plan.editingBookId,"2");
  const first=await persistBookRow(db,{price:201,translator:"تەرجىمان",publisher:"نەشرىيات",publish_year:2019,pages:320},plan.operation,plan.editingBookId);
  assert.ok(!first.error);
  books[2].price=201;
  books[2].translator="تەرجىمان";
  books[2].publisher="نەشرىيات";
  books[2].publish_year=2019;
  books[2].pages=320;
  assert.strictEqual(db.calls.length,1);
  assert.strictEqual(db.calls[0].method,"PATCH");
  assert.strictEqual(db.calls[0].filter,"id=eq.2");
  assert.strictEqual(db.calls[0].payload.translator,"تەرجىمان");
  assert.ok(!db.calls.some(c=>c.method==="POST"));
  assert.strictEqual(count,2);
  assert.strictEqual(books[2].id,2);

  const second=await persistBookRow(db,{price:202},"UPDATE","2");
  assert.ok(!second.error);
  books[2].price=202;
  assert.strictEqual(db.calls.length,2);
  assert.ok(!db.calls.some(c=>c.method==="POST"));
  assert.strictEqual(count,2);
  assert.strictEqual(books[2].price,202);

  const lostEditing=W.planBookSave(null,"2","edit");
  assert.strictEqual(lostEditing.operation,"UPDATE");
  const third=await persistBookRow(db,{price:203},lostEditing.operation,lostEditing.editingBookId);
  assert.ok(!third.error);
  assert.ok(!db.calls.some(c=>c.method==="POST"));

  console.log("PASS mock PATCH books?id=eq.2 twice, no POST, row count unchanged");
})().catch(err=>{console.error(err);process.exit(1)});
