import { PageHeader, Card } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type FeedItem = {
  type: string;
  id: string;
  createdAt: string;
  giver_name?: string;
  receiver_name?: string;
  badge?: string;
  message?: string;
  name?: string;
  department?: string;
  designation?: string;
  title?: string;
  body?: string;
  category?: string;
  pinned?: boolean;
  author?: string;
  joiningDate?: string;
} & Record<string, unknown>;

const BADGE_EMOJI: Record<string, string> = {
  star: "⭐", rocket: "🚀", heart: "❤️", trophy: "🏆", fire: "🔥", lightning: "⚡", thumbsup: "👍",
};

async function getData(): Promise<LoaderResult<FeedItem[]>> {
  const r = await fetchJson<unknown, FeedItem[]>("/api/v1/hrms/social/feed", [], {
    telemetryKey: "hr.social-feed",
    mapResponse: (p) => {
      const arr = (p as { data?: FeedItem[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function SocialFeedPage() {
  const { data: feed, source } = await getData();

  const kudosCount = feed.filter((f) => f.type === "kudos").length;
  const birthdayCount = feed.filter((f) => f.type === "birthday").length;
  const newJoineeCount = feed.filter((f) => f.type === "new_joinee").length;
  const announcementCount = feed.filter((f) => f.type === "announcement").length;

  return (
    <div className="space-y-6">
      <PageHeader title="Social Feed" subtitle="Kudos, birthdays, new joinees, and announcements" />

      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border p-4 text-center">
          <p className="text-2xl font-bold text-amber-500">{kudosCount}</p>
          <p className="text-xs text-gray-500">Kudos This Week</p>
        </div>
        <div className="rounded-lg border p-4 text-center">
          <p className="text-2xl font-bold text-pink-500">{birthdayCount}</p>
          <p className="text-xs text-gray-500">Birthdays Today</p>
        </div>
        <div className="rounded-lg border p-4 text-center">
          <p className="text-2xl font-bold text-green-500">{newJoineeCount}</p>
          <p className="text-xs text-gray-500">New Joinees</p>
        </div>
        <div className="rounded-lg border p-4 text-center">
          <p className="text-2xl font-bold text-indigo-500">{announcementCount}</p>
          <p className="text-xs text-gray-500">Announcements</p>
        </div>
      </div>

      <div className="space-y-4 max-w-2xl">
        {feed.length === 0 && (
          <div className="rounded-lg border p-8 text-center text-gray-400">
            <p className="text-4xl mb-3">🎉</p>
            <p>No updates yet. Give kudos to a colleague to start the feed!</p>
          </div>
        )}

        {feed.map((item) => {
          if (item.type === "kudos") {
            return (
              <div key={item.id} className="rounded-lg border bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{BADGE_EMOJI[item.badge ?? "star"]}</span>
                  <div>
                    <p className="text-sm">
                      <span className="font-semibold">{item.giver_name}</span>
                      {" appreciated "}
                      <span className="font-semibold">{item.receiver_name}</span>
                    </p>
                    {item.message && (
                      <p className="mt-1 text-sm text-gray-600 italic bg-gray-50 rounded p-2">{item.message}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          }
          if (item.type === "birthday") {
            return (
              <div key={item.id} className="rounded-lg border p-4 bg-gradient-to-r from-pink-50 to-yellow-50">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">🎂</span>
                  <div>
                    <p className="font-semibold text-pink-700">Happy Birthday, {item.name}!</p>
                    <p className="text-sm text-gray-600">{item.designation} • {item.department}</p>
                  </div>
                </div>
              </div>
            );
          }
          if (item.type === "new_joinee") {
            return (
              <div key={item.id} className="rounded-lg border p-4 bg-gradient-to-r from-green-50 to-emerald-50">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">👋</span>
                  <div>
                    <p className="font-semibold text-green-700">Welcome {item.name}!</p>
                    <p className="text-sm text-gray-600">Joined as {item.designation} in {item.department}</p>
                  </div>
                </div>
              </div>
            );
          }
          if (item.type === "announcement") {
            return (
              <div key={item.id} className={`rounded-lg border p-4 bg-white shadow-sm ${item.pinned ? "border-indigo-200" : ""}`}>
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{item.pinned ? "📌" : "📢"}</span>
                  <div>
                    <p className="font-semibold">{item.title}</p>
                    <p className="text-sm text-gray-600 mt-1 line-clamp-3">{item.body}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">{item.category}</span>
                      <span className="text-xs text-gray-400">by {item.author}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
