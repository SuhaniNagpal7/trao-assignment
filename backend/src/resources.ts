import { settings } from "./config.js";
import type { Context, Step } from "./pipeline.js";
export function duration(value: string) {
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  return m
    ? Math.ceil(
        (Number(m[1] || 0) * 86400 +
          Number(m[2] || 0) * 3600 +
          Number(m[3] || 0) * 60 +
          Number(m[4] || 0)) /
          60,
      )
    : 0;
}
async function get(
  endpoint: string,
  params: Record<string, string>,
  deadline: number,
) {
  if (!settings.youtubeKey)
    return {
      items: [],
      limitation:
        "Optional YouTube discovery is not configured. Your course reading is self-contained.",
    };
  try {
    const u = new URL("https://www.googleapis.com/youtube/v3/" + endpoint);
    Object.entries({ ...params, key: settings.youtubeKey }).forEach(([k, v]) =>
      u.searchParams.set(k, v),
    );
    const r = await fetch(u, {
      signal: AbortSignal.timeout(
        Math.max(1, Math.min(15000, deadline - Date.now())),
      ),
    });
    if (!r.ok) throw new Error();
    const body = await r.text();
    if (body.length > 200000) throw new Error();
    return JSON.parse(body);
  } catch {
    return {
      items: [],
      limitation:
        "YouTube metadata was unavailable; no unverified links were recommended.",
    };
  }
}
const valid = (items: any[]) =>
  items.filter(
    (i) =>
      i.status?.privacyStatus === "public" &&
      (i.snippet?.liveBroadcastContent || "none") === "none" &&
      duration(i.contentDetails?.duration || "") > 0,
  );
export function resourceSteps(snapshot: any): Step[] {
  return [
    {
      key: "resource_search",
      label: "Discover topic videos and playlists",
      run: async (c) => {
        const topics = [...snapshot._base_kit.role.requirements].sort(
          (a, b) =>
            Number(a.priority !== "must") - Number(b.priority !== "must") ||
            a.id.localeCompare(b.id),
        );
        if (!topics.length)
          return {
            items: [],
            limitation: "Add a specific topic before searching for resources.",
          };
        const t = topics[0];
        return {
          ...(await get(
            "search",
            {
              part: "snippet",
              type: snapshot.days >= 21 ? "video,playlist" : "video",
              q: t.text.slice(0, 180) + " tutorial",
              maxResults: "5",
              safeSearch: "strict",
            },
            c.deadline,
          )),
          requirement_id: t.id,
        };
      },
    },
    {
      key: "resource_videos",
      label: "Verify video availability and duration",
      run: (c) => {
        const ids = (c.outputs.resource_search.items || [])
          .map((i: any) => i.id?.videoId)
          .filter(Boolean);
        return ids.length
          ? get(
              "videos",
              { part: "snippet,contentDetails,status", id: ids.join(",") },
              c.deadline,
            )
          : { items: [] };
      },
    },
    {
      key: "resource_playlist",
      label: "Inspect a relevant playlist",
      run: async (c) => {
        const item = (c.outputs.resource_search.items || []).find(
          (i: any) => i.id?.playlistId,
        );
        if (!item || snapshot.days < 21) return { items: [] };
        const result = await get(
          "playlistItems",
          {
            part: "contentDetails",
            playlistId: item.id.playlistId,
            maxResults: "50",
          },
          c.deadline,
        );
        if (result.nextPageToken || result.items.length > 20)
          return {
            items: [],
            limitation:
              "Long playlists were omitted because their complete duration could not be verified within the lookup budget.",
          };
        return {
          ...result,
          playlist_id: item.id.playlistId,
          title: item.snippet.title,
        };
      },
    },
    {
      key: "resource_playlist_videos",
      label: "Verify every playlist video",
      run: (c) => {
        const ids = (c.outputs.resource_playlist.items || []).map(
          (i: any) => i.contentDetails.videoId,
        );
        return ids.length
          ? get(
              "videos",
              { part: "snippet,contentDetails,status", id: ids.join(",") },
              c.deadline,
            )
          : { items: [] };
      },
    },
    {
      key: "save_resources",
      label: "Save verified optional resources",
      run: (c: Context) => {
        const resources: any[] = [],
          rid = c.outputs.resource_search.requirement_id,
          verified_at = new Date().toISOString();
        for (const i of valid(c.outputs.resource_videos.items || [])) {
          const minutes = duration(i.contentDetails.duration);
          if (minutes <= snapshot.daily_minutes)
            resources.push({
              id: "youtube:" + i.id,
              title: i.snippet.title,
              url: "https://www.youtube.com/watch?v=" + i.id,
              minutes,
              requirement_ids: [rid],
              kind: "video",
              verified_at,
            });
        }
        const p = c.outputs.resource_playlist,
          expected = (p.items || []).map((i: any) => i.contentDetails.videoId),
          videos = valid(c.outputs.resource_playlist_videos.items || []);
        if (
          expected.length &&
          expected.every((id: string) => videos.some((i) => i.id === id))
        ) {
          const minutes = expected.reduce(
            (n: number, id: string) =>
              n +
              duration(videos.find((i) => i.id === id).contentDetails.duration),
            0,
          );
          if (minutes <= snapshot.daily_minutes)
            resources.push({
              id: "playlist:" + p.playlist_id,
              title: p.title,
              url: "https://www.youtube.com/playlist?list=" + p.playlist_id,
              minutes,
              requirement_ids: [rid],
              kind: "playlist",
              verified_at,
            });
        }
        return {
          resources,
          limitations: Object.values(c.outputs)
            .map((v) => v?.limitation)
            .filter(Boolean),
          note: "Public availability and duration verified through YouTube. Relevance follows the topic search; educational accuracy is not independently verified.",
        };
      },
    },
  ];
}
