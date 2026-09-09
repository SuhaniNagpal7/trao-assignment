import { lookup } from "node:dns/promises";
import { Agent, fetch as safeFetch } from "undici";
import ipaddr from "ipaddr.js";
import { createRequire } from "node:module";
const robotsParser = createRequire(import.meta.url)("robots-parser") as (
  url: string,
  text: string,
) => {
  isAllowed: (url: string, agent: string) => boolean | undefined;
  getCrawlDelay: (agent: string) => number | undefined;
};
import { load } from "cheerio";
import { url } from "./schemas.js";
import { settings } from "./config.js";
import { AppError, deadlineCheck, sleep } from "./errors.js";
export type Page = {
  url: string;
  text: string;
  kind: string;
  fetched_at: string;
};
export type Research = {
  sources: Page[];
  skipped: { url?: string; reason: string }[];
  limitations?: string[];
};
export function publicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export async function retrieve(
  address: string,
  deadline: number,
  allowLocal = false,
): Promise<{ url: string; text: string; type: string }> {
  let current = url.parse(address);
  for (let redirect = 0; redirect < 5; redirect++) {
    deadlineCheck(deadline);
    const u = new URL(current);
    const hostname = u.hostname.replace(/^\[|\]$/g, "");
    const addresses = await lookup(hostname, { all: true });
    if (
      !addresses.length ||
      ((settings.production || !allowLocal) &&
        addresses.some((a) => !publicAddress(a.address)))
    )
      throw new AppError(
        422,
        "UNSAFE_URL",
        "Private and reserved network addresses are not permitted.",
      );
    const selected = addresses.find((a) => a.family === 4) || addresses[0];
    const dispatcher = new Agent({
      connect: {
        lookup: (_hostname, options, cb) => {
          // Node's family auto-selection requests an array with all:true.
          // Both callback shapes must return only the already-validated IP.
          if (options.all) cb(null, [selected]);
          else cb(null, selected.address, selected.family);
        },
      },
    });
    try {
      const response = await safeFetch(current, {
        dispatcher,
        redirect: "manual",
        headers: {
          "User-Agent": "AheadPrepBot/1.0",
          Accept: "text/html,text/plain",
        },
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(12000, deadline - Date.now())),
        ),
      });
      if (response.status >= 300 && response.status < 400) {
        const loc = response.headers.get("location");
        await response.body?.cancel();
        if (!loc) throw new Error("Redirect without destination");
        current = url.parse(new URL(loc, current).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      const type = response.headers.get("content-type") || "";
      if (!/^(text\/html|text\/plain|application\/xhtml\+xml)/i.test(type)) {
        await response.body?.cancel();
        throw new Error("Unsupported content type");
      }
      if (Number(response.headers.get("content-length") || 0) > 1000000) {
        await response.body?.cancel();
        throw new Error("Page exceeds size limit");
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body!) {
        size += chunk.length;
        if (size > 1000000) throw new Error("Page exceeds size limit");
        chunks.push(chunk);
      }
      return {
        url: current,
        text: Buffer.concat(chunks).toString("utf8"),
        type,
      };
    } finally {
      await dispatcher.close();
    }
  }
  throw new Error("Too many redirects");
}
export async function crawlCompany(
  address: string,
  deadline: number,
  allowLocal = false,
): Promise<Research> {
  const result: Research = { sources: [], skipped: [] };
  const origin = new URL(address).origin;
  let robots;
  try {
    const page = await retrieve(origin + "/robots.txt", deadline, allowLocal);
    robots = robotsParser(origin + "/robots.txt", page.text);
  } catch (e) {
    if (!(e instanceof Error && e.message === "HTTP 404")) {
      result.skipped.push({
        url: origin,
        reason: "Robots policy could not be verified; company crawl skipped.",
      });
      return result;
    }
  }
  const queue = [address],
    seen = new Set<string>();
  while (queue.length && seen.size < 6) {
    const target = queue.shift()!;
    if (seen.has(target)) continue;
    seen.add(target);
    if (robots?.isAllowed(target, "AheadPrepBot") === false) {
      result.skipped.push({ url: target, reason: "Disallowed by robots.txt" });
      continue;
    }
    try {
      const delay = Math.max(300, (robots?.getCrawlDelay("AheadPrepBot") || 0) * 1000);
      if (seen.size > 1) {
        if (Date.now() + delay >= deadline) throw new Error("Crawl delay exceeds remaining time budget");
        await sleep(delay);
      }
      const page = await retrieve(target, deadline, allowLocal);
      if (new URL(page.url).origin !== origin) {
        result.skipped.push({
          url: target,
          reason: "Redirect left company origin",
        });
        continue;
      }
      const $ = load(page.text);
      $("script,style,noscript,svg,iframe,form").remove();
      const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 14000);
      result.sources.push({
        url: page.url,
        text,
        kind: /hir|interview|career|recruit/i.test(
          target + " " + $("title").text(),
        )
          ? "hiring_page"
          : "company_page",
        fetched_at: new Date().toISOString(),
      });
      const links = $("a[href]")
        .toArray()
        .map((a) => {
          try {
            const href = new URL($(a).attr("href")!, page.url);
            href.hash = "";
            const label = ($(a).text() + " " + href.pathname).toLowerCase();
            return {
              url: href.href,
              score:
                (/interview|hiring|recruit/.test(label) ? 10 : 0) +
                (/career|jobs|handbook|engineering/.test(label) ? 5 : 0) +
                (/about|company|team|story/.test(label) ? 3 : 0),
            };
          } catch {
            return { url: "", score: 0 };
          }
        })
        .filter(
          (a) =>
            a.score > 0 && new URL(a.url).origin === origin && !seen.has(a.url),
        )
        .sort((a, b) => b.score - a.score);
      queue.push(...links.map((a) => a.url));
    } catch (e) {
      result.skipped.push({
        url: target,
        reason:
          e instanceof AppError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Page unavailable",
      });
    }
  }
  return result;
}
export async function searchInterviews(
  company: string,
  deadline: number,
): Promise<Research> {
  if (!settings.tavilyKey)
    return {
      sources: [],
      skipped: [],
      limitations: [
        "Public interview search is unavailable until TAVILY_API_KEY is configured. No interview experiences were invented.",
      ],
    };
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: settings.tavilyKey,
        query: `${company} interview experience hiring process`,
        max_results: 4,
        search_depth: "basic",
      }),
      signal: AbortSignal.timeout(
        Math.max(1, Math.min(15000, deadline - Date.now())),
      ),
    });
    if (!response.ok) throw new Error();
    const data: any = await response.json();
    return {
      sources: (data.results || [])
        .filter((r: any) => url.safeParse(r.url).success)
        .map((r: any) => ({
          url: r.url,
          text: String(r.content || "").slice(0, 4000),
          kind: "anecdotal_search_snippet",
          fetched_at: new Date().toISOString(),
        })),
      skipped: [],
      limitations: [
        "Candidate reports are anecdotal, not confirmed company policy.",
      ],
    };
  } catch {
    return {
      sources: [],
      skipped: [{ reason: "Public interview search was unavailable." }],
    };
  }
}
