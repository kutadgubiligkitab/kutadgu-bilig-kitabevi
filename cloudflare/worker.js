import publicBook from "../kutadgu-public-book.js";
import listing from "../kutadgu-category-listing.js";
import sitemap from "../kutadgu-sitemap.js";
import seo from "../kutadgu-book-seo.js";
import aiSearch from "../kutadgu-ai-search.js";
import preview from "./preview-dispatch.js";

export default {
  async fetch(request, env) {
    try {
      return await preview.dispatch(request, env, {
        publicBook,
        listing,
        sitemap,
        seo,
        aiSearch,
        fetchImpl: globalThis.fetch.bind(globalThis)
      });
    } catch (err) {
      return new Response("preview failed", {
        status: 503,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store"
        }
      });
    }
  }
};
