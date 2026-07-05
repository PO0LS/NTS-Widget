import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

const mono = `"SF Mono", "Menlo", "Courier New", monospace`;

const STREAM_URLS = {
  1: "http://stream-master.ntslive.net:8000/stream",
  2: "http://stream-master.ntslive.net:8000/stream2",
};

const FAVORITES_KEY = "nts-widget-favorites";

const loadFavorites = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"));
  } catch {
    return new Set();
  }
};

const saveFavorites = (set) => {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(set)));
};

const DEFAULT_ACCENT = "#ff3b1f";
const ACCENT_PRESETS = [
  "#ff3b1f",
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#ec4899",
  "#eab308",
  "#ffffff",
];

const PREFS_KEY = "nts-widget-prefs";
const DEFAULT_PREFS = {
  accentColor: DEFAULT_ACCENT,
  notificationsEnabled: true,
  defaultChannel: "1",
  autoResumeLastStation: false,
  showNowPlayingInMenuBar: true,
  timeFormat: "24h",
  theme: "auto",
};

// Light-mode greys aren't a plain 255-minus-channel mirror of dark-mode's —
// that made prominent text (grey-888/777, used for subtitles) too washed
// out on a white background (~3.5:1 contrast). Instead each tier's rank
// (how prominent/readable it is) is preserved: the tier that's *lightest*
// (most prominent) in dark mode becomes the *darkest* (most prominent) in
// light mode, i.e. the six values are reassigned in reverse, not inverted.
const THEME_VARS = {
  dark: {
    "--bg": "#000",
    "--text": "#fff",
    "--border": "#1a1a1a",
    "--border-strong": "#333",
    "--surface": "#222",
    "--grey-999": "#999",
    "--grey-888": "#888",
    "--grey-777": "#777",
    "--grey-666": "#666",
    "--grey-555": "#555",
    "--grey-444": "#444",
  },
  light: {
    "--bg": "#fff",
    "--text": "#111",
    "--border": "#e5e5e5",
    "--border-strong": "#ccc",
    "--surface": "#ddd",
    "--grey-999": "#444",
    "--grey-888": "#555",
    "--grey-777": "#666",
    "--grey-666": "#777",
    "--grey-555": "#888",
    "--grey-444": "#999",
  },
};

const resolveTheme = (theme) => {
  if (theme === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme;
};

const loadPrefs = () => {
  try {
    return {
      ...DEFAULT_PREFS,
      ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
};

const savePrefs = (prefs) => {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
};

const LAST_CHANNEL_KEY = "nts-widget-last-channel";

// Dedupes "coming up" favorite notifications across the 5-min schedule poll
// (each poll rebuilds Row instances, so this can't live in component state).
const notifiedEpisodes = new Set();

// NTS's API inconsistently pre-escapes some titles (literal "&#039;" instead
// of an apostrophe) but not others — decode defensively wherever text is shown.
const decodeHtml = (str) => {
  if (!str) return str;
  const el = document.createElement("textarea");
  el.innerHTML = str;
  return el.value;
};

// "(R)" is NTS's own marker for a repeat/rerun broadcast, baked directly
// into broadcast_title — strip the literal text everywhere it's rendered
// and swap in a spelled-out "(REPEAT)" label instead.
const REPEAT_SUFFIX = /\s*\(R\)\s*$/i;

const parseRepeatTitle = (title) => {
  const clean = decodeHtml(title);
  const isRepeat = REPEAT_SUFFIX.test(clean);
  return { title: clean.replace(REPEAT_SUFFIX, "").trim(), isRepeat };
};

const RepeatIcon = () => (
  <span
    style={{
      fontFamily: mono,
      fontSize: 9,
      color: "var(--grey-666)",
      letterSpacing: 0.5,
      marginLeft: 6,
      flexShrink: 0,
      whiteSpace: "nowrap",
    }}
  >
    (REPEAT)
  </span>
);

// The tray title is a plain OS string (no icon glyphs reliably render there),
// so it just drops "(R)" and tags the channel number instead.
const formatTrayTitle = (title, channel) => {
  const { title: clean } = parseRepeatTitle(title);
  return `${clean} · NTS ${channel}`;
};

// Pulled straight from the schedule endpoint's episode link (.../shows/{alias}/episodes/...)
// so the favorites view can match shows without an extra per-row fetch.
const showAliasFromBroadcast = (broadcast) => {
  const link =
    broadcast.links && broadcast.links.find((l) => l.rel === "details");
  const match = link && link.href.match(/\/shows\/([^/]+)\/episodes\//);
  return match ? match[1] : null;
};

const fmtClock = (iso, use12h) => {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return d.toLocaleTimeString([], {
    hour: use12h ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12: !!use12h,
  });
};

const episodeUrl = (broadcast) => {
  const link =
    broadcast.links && broadcast.links.find((l) => l.rel === "details");
  if (!link) return null;
  return link.href.replace("/api/v2", "");
};

// The /live endpoint's "now" object has no top-level links (unlike schedule
// broadcasts) — build the episode page URL directly from its embedded alias fields.
const liveEpisodeUrl = (now) => {
  const details = (now.embeds && now.embeds.details) || {};
  if (!details.show_alias || !details.episode_alias) return null;
  return `https://www.nts.live/shows/${details.show_alias}/episodes/${details.episode_alias}`;
};

// Schedule days are midnight-to-midnight in the station's timezone, so
// flattening across days gives one continuous chronological feed where a
// live show near day's end can still have "upcoming" entries after it (from
// the next day).
const flattenBroadcasts = (days) => {
  const rows = [];
  for (const day of days) {
    for (const b of day.broadcasts) {
      rows.push(b);
    }
  }
  return rows;
};

// Date dividers follow the viewer's local calendar day (so a divider lands
// above the row that reads "00:00"), not the station's own day boundary.
const localDateKey = (iso) => new Date(iso).toDateString();

const localDateLabel = (iso) => {
  const d = new Date(iso);
  const dow = d.toLocaleDateString([], { weekday: "long" }).toUpperCase();
  const date = d.toLocaleDateString("en-CA");
  return `${dow} · ${date}`;
};

// Index of the broadcast spanning right now; falls back to the most recently
// started broadcast if nothing is live.
const findLiveIndex = (rows, nowMs) => {
  for (let i = 0; i < rows.length; i++) {
    const s = new Date(rows[i].start_timestamp).getTime();
    const e = new Date(rows[i].end_timestamp).getTime();
    if (s <= nowMs && nowMs < e) return i;
  }
  let idx = 0;
  for (let i = 0; i < rows.length; i++) {
    if (new Date(rows[i].start_timestamp).getTime() <= nowMs) idx = i;
  }
  return idx;
};

const PAST_COUNT = 4;
const FUTURE_COUNT = 14;

// Both endpoints below send Cache-Control: max-age=900 (15min) off a
// CloudFront edge cache — cache: "no-store" only stops the local browser
// cache, CloudFront still serves its own stale copy for the same URL. A
// unique query param per request makes it a "new" URL to the CDN so it
// can't serve anything cached, forcing a real hit to origin every time.
async function fetchSchedules() {
  const bust = Date.now();
  const [ch1, ch2] = await Promise.all([
    fetch(
      `https://www.nts.live/api/v2/radio/schedule/1?past_days=1&_=${bust}`,
      { cache: "no-store" },
    ).then((r) => r.json()),
    fetch(
      `https://www.nts.live/api/v2/radio/schedule/2?past_days=1&_=${bust}`,
      { cache: "no-store" },
    ).then((r) => r.json()),
  ]);
  return { ch1, ch2 };
}

// The live endpoint (unlike the schedule endpoint) embeds artwork, genre,
// location and description for whatever's on air right now.
async function fetchLive() {
  const res = await fetch(`https://www.nts.live/api/v2/live?_=${Date.now()}`, {
    cache: "no-store",
  }).then((r) => r.json());
  const results = res.results || [];
  const find = (ch) => {
    const entry = results.find((r) => r.channel_name === ch);
    return entry && entry.now;
  };
  return { ch1: find("1"), ch2: find("2") };
}

const Row = ({
  broadcast,
  expanded,
  onToggle,
  favorites,
  onToggleFavorite,
  notificationsEnabled,
  use12h,
}) => {
  const start = new Date(broadcast.start_timestamp).getTime();
  const end = new Date(broadcast.end_timestamp).getTime();
  const now = Date.now();
  const isLive = start <= now && now < end;
  const isFuture = start > now;
  const url = episodeUrl(broadcast);
  const progress = isLive
    ? Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100))
    : 0;

  const [episode, setEpisode] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const link =
      broadcast.links && broadcast.links.find((l) => l.rel === "details");
    if (!link) return;
    fetch(link.href)
      .then((r) => r.json())
      .then((ep) => {
        if (cancelled) return;
        setEpisode(ep);
        if (
          notificationsEnabled &&
          isFuture &&
          favorites.has(ep.show_alias) &&
          !notifiedEpisodes.has(ep.episode_alias)
        ) {
          notifiedEpisodes.add(ep.episode_alias);
          new Notification(
            `Coming up: ${parseRepeatTitle(ep.name || broadcast.broadcast_title).title}`,
            {
              body: `Starts at ${fmtClock(broadcast.start_timestamp, use12h)}`,
            },
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [broadcast.links]);

  const genre =
    episode && episode.genres && episode.genres.length
      ? episode.genres[0].value
      : null;
  const art =
    episode &&
    episode.media &&
    (episode.media.picture_small || episode.media.picture_medium);
  const location = episode && episode.location_long;
  const showAlias = episode && episode.show_alias;
  const isFavorite = showAlias && favorites.has(showAlias);
  const { title: cleanTitle, isRepeat } = parseRepeatTitle(
    broadcast.broadcast_title,
  );

  return (
    <div
      style={{
        borderLeft: isLive
          ? "3px solid var(--accent)"
          : "3px solid transparent",
        borderBottom: "1px solid var(--border)",
        opacity: isFuture ? 0.4 : 1,
      }}
    >
      <div
        onClick={() => onToggle()}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "10px 16px 10px 12px",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            fontFamily: mono,
            fontSize: 11,
            color: isLive ? "var(--accent)" : "var(--grey-666)",
            paddingTop: 2,
            width: 58,
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          {fmtClock(broadcast.start_timestamp, use12h)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {isLive && (
              <div
                className="pulse-dot"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  flexShrink: 0,
                }}
              />
            )}
            {!isLive && showAlias && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(showAlias);
                }}
                style={{
                  fontSize: 11,
                  color: isFavorite ? "var(--accent)" : "var(--grey-444)",
                  flexShrink: 0,
                  cursor: "pointer",
                }}
              >
                {isFavorite ? "★" : "☆"}
              </div>
            )}
            <div
              style={{
                flex: "0 1 auto",
                minWidth: 0,
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text)",
                textTransform: "uppercase",
                letterSpacing: -0.1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {cleanTitle}
            </div>
            {isRepeat && <RepeatIcon />}
            {genre && (
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 9,
                  color: "var(--grey-666)",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                  marginLeft: "auto",
                }}
              >
                {genre}
              </div>
            )}
          </div>
          {isLive && (
            <div
              style={{ marginTop: 6, height: 2, background: "var(--surface)" }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progress}%`,
                  background: "var(--accent)",
                }}
              />
            </div>
          )}
        </div>
      </div>
      {expanded && episode && (
        <div style={{ display: "flex", gap: 12, padding: "0 16px 12px 12px" }}>
          <div style={{ width: 42, flexShrink: 0 }}>
            {art && (
              <img
                src={art}
                width={36}
                height={36}
                style={{ objectFit: "cover", filter: "grayscale(15%)" }}
              />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {(location || genre) && (
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  color: "var(--grey-777)",
                  letterSpacing: 0.3,
                }}
              >
                {[location, genre].filter(Boolean).join("  ·  ")}
              </div>
            )}
            {episode.description && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--grey-999)",
                  marginTop: 4,
                  lineHeight: 1.4,
                  maxHeight: 46,
                  overflowY: "auto",
                }}
              >
                {decodeHtml(episode.description)}
              </div>
            )}
            {url && (
              <div
                onClick={() => window.nts.openUrl(url)}
                style={{
                  fontFamily: mono,
                  fontSize: 9,
                  color: "var(--grey-888)",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 3,
                  padding: "1px 5px",
                  opacity: 0.6,
                  cursor: "pointer",
                  display: "inline-block",
                  marginTop: 6,
                }}
              >
                Link
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const NowPlaying = ({
  now,
  isPlaying,
  onTogglePlay,
  favorites,
  onToggleFavorite,
  sleepMinutes,
  onCycleSleep,
  use12h,
}) => {
  if (!now) {
    return (
      <div
        style={{
          padding: 18,
          color: "var(--grey-666)",
          fontFamily: mono,
          fontSize: 12,
          borderBottom: "1px solid var(--border)",
        }}
      >
        couldn't reach NTS
      </div>
    );
  }

  const details = (now.embeds && now.embeds.details) || {};
  const art =
    details.media &&
    (details.media.picture_medium || details.media.background_medium);
  const genre =
    details.genres && details.genres.length ? details.genres[0].value : null;
  const location = details.location_long || null;
  const start = new Date(now.start_timestamp).getTime();
  const end = new Date(now.end_timestamp).getTime();
  const nowMs = Date.now();
  const progress = Math.min(
    100,
    Math.max(0, ((nowMs - start) / (end - start)) * 100),
  );
  const url = liveEpisodeUrl(now);
  const showAlias = details.show_alias;
  const isFavorite = showAlias && favorites.has(showAlias);
  const { title: cleanTitle, isRepeat } = parseRepeatTitle(
    details.name || now.broadcast_title,
  );

  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        padding: "16px 16px 14px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {art && (
        <div
          style={{ position: "relative", width: 76, height: 76, flexShrink: 0 }}
        >
          <img
            src={art}
            width={76}
            height={76}
            style={{
              objectFit: "cover",
              filter: "grayscale(15%)",
              display: "block",
            }}
          />
          <div
            onClick={onTogglePlay}
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: "rgba(0,0,0,0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {isPlaying ? (
                <div style={{ display: "flex", gap: 3 }}>
                  <div style={{ width: 3, height: 12, background: "#fff" }} />
                  <div style={{ width: 3, height: 12, background: "#fff" }} />
                </div>
              ) : (
                <div
                  style={{
                    width: 0,
                    height: 0,
                    borderTop: "6px solid transparent",
                    borderBottom: "6px solid transparent",
                    borderLeft: "10px solid #fff",
                    marginLeft: 2,
                  }}
                />
              )}
            </div>
          </div>
          <div
            onClick={onCycleSleep}
            style={{
              marginTop: 8,
              textAlign: "center",
              fontFamily: mono,
              fontSize: 8,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              color: sleepMinutes ? "var(--accent)" : "var(--grey-555)",
              cursor: "pointer",
            }}
          >
            Sleep: {sleepMinutes ? formatSleepLabel(sleepMinutes) : "Off"}
          </div>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div
            className="pulse-dot"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent)",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: 2,
              color: "var(--accent)",
              textTransform: "uppercase",
            }}
          >
            On Air
          </span>
          <span
            style={{
              fontFamily: mono,
              fontSize: 10,
              color: "var(--grey-555)",
              marginLeft: "auto",
            }}
          >
            {fmtClock(now.start_timestamp, use12h)}&ndash;
            {fmtClock(now.end_timestamp, use12h)}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 6,
          }}
        >
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "var(--text)",
              textTransform: "uppercase",
              lineHeight: 1.2,
              letterSpacing: -0.3,
              minWidth: 0,
            }}
          >
            {cleanTitle}
            {isRepeat && <RepeatIcon />}
          </div>
          {url && (
            <div
              onClick={() => window.nts.openUrl(url)}
              style={{
                fontFamily: mono,
                fontSize: 9,
                color: "var(--grey-888)",
                letterSpacing: 0.5,
                textTransform: "uppercase",
                flexShrink: 0,
                border: "1px solid var(--border-strong)",
                borderRadius: 3,
                padding: "2px 6px",
                marginLeft: 10,
                opacity: 0.6,
                cursor: "pointer",
              }}
            >
              Link
            </div>
          )}
          {showAlias && (
            <div
              onClick={() => onToggleFavorite(showAlias)}
              style={{
                fontSize: 15,
                color: isFavorite ? "var(--accent)" : "var(--grey-444)",
                flexShrink: 0,
                cursor: "pointer",
              }}
            >
              {isFavorite ? "★" : "☆"}
            </div>
          )}
        </div>
        {(location || genre) && (
          <div
            style={{
              fontFamily: mono,
              fontSize: 11,
              color: "var(--grey-888)",
              marginTop: 4,
              letterSpacing: 0.3,
            }}
          >
            {[location, genre].filter(Boolean).join("  ·  ")}
          </div>
        )}
        {details.description && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: 11,
              color: "var(--grey-999)",
              marginTop: 6,
              lineHeight: 1.4,
              maxHeight: 46,
              overflowY: "auto",
              cursor: "auto",
              WebkitAppRegion: "no-drag",
            }}
          >
            {decodeHtml(details.description)}
          </div>
        )}
        <div style={{ marginTop: 10, height: 2, background: "var(--surface)" }}>
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: "var(--accent)",
            }}
          />
        </div>
      </div>
    </div>
  );
};

const ChannelPane = ({
  data,
  active,
  favorites,
  onToggleFavorite,
  notificationsEnabled,
  use12h,
}) => {
  const [expandedKey, setExpandedKey] = useState(null);

  if (!active) return null;

  if (!data || !data.results || !data.results.length) {
    return (
      <div
        style={{
          height: 300,
          boxSizing: "border-box",
          padding: 20,
          color: "var(--grey-666)",
          fontFamily: mono,
          fontSize: 12,
        }}
      >
        couldn't reach NTS
      </div>
    );
  }

  const rows = flattenBroadcasts(data.results);
  const liveIdx = findLiveIndex(rows, Date.now());
  const windowStart = Math.max(0, liveIdx - PAST_COUNT);
  const windowEnd = Math.min(rows.length, liveIdx + FUTURE_COUNT + 1);
  const windowRows = rows.slice(windowStart, windowEnd);

  let lastDateKey = null;

  return (
    <div style={{ height: 300, overflowY: "auto" }}>
      {windowRows.map((b, i) => {
        const key = windowStart + i;
        const dateKey = localDateKey(b.start_timestamp);
        const showDateDivider = dateKey !== lastDateKey;
        lastDateKey = dateKey;
        return (
          <React.Fragment key={key}>
            {showDateDivider && (
              <div
                style={{
                  padding: "10px 16px 6px",
                  fontFamily: mono,
                  fontSize: 10,
                  color: "var(--grey-555)",
                  letterSpacing: 2,
                  textTransform: "uppercase",
                }}
              >
                {localDateLabel(b.start_timestamp)}
              </div>
            )}
            <Row
              broadcast={b}
              expanded={expandedKey === key}
              onToggle={() =>
                setExpandedKey((prev) => (prev === key ? null : key))
              }
              favorites={favorites}
              onToggleFavorite={onToggleFavorite}
              notificationsEnabled={notificationsEnabled}
              use12h={use12h}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
};

const FavoritesView = ({ data, favorites, onToggleFavorite, use12h }) => {
  if (!favorites.size) {
    return (
      <div
        style={{
          height: 300,
          boxSizing: "border-box",
          padding: 20,
          color: "var(--grey-666)",
          fontFamily: mono,
          fontSize: 12,
        }}
      >
        No favorites yet &mdash; tap &#9734; on any show to track it.
      </div>
    );
  }

  const entries = [];
  for (const ch of ["1", "2"]) {
    const chData = data && data[`ch${ch}`];
    if (!chData || !chData.results) continue;
    for (const b of flattenBroadcasts(chData.results)) {
      const alias = showAliasFromBroadcast(b);
      if (alias && favorites.has(alias)) {
        entries.push({ broadcast: b, channel: ch, alias });
      }
    }
  }
  entries.sort(
    (a, b) =>
      new Date(a.broadcast.start_timestamp) -
      new Date(b.broadcast.start_timestamp),
  );

  if (!entries.length) {
    return (
      <div
        style={{
          height: 300,
          boxSizing: "border-box",
          padding: 20,
          color: "var(--grey-666)",
          fontFamily: mono,
          fontSize: 12,
        }}
      >
        None of your favorited shows are in the current schedule window yet.
      </div>
    );
  }

  return (
    <div style={{ height: 300, overflowY: "auto" }}>
      {entries.map((e, i) => {
        const start = new Date(e.broadcast.start_timestamp).getTime();
        const end = new Date(e.broadcast.end_timestamp).getTime();
        const now = Date.now();
        const isLive = start <= now && now < end;
        const isFuture = start > now;
        const url = episodeUrl(e.broadcast);
        const { title: cleanTitle, isRepeat } = parseRepeatTitle(
          e.broadcast.broadcast_title,
        );
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 16px",
              borderLeft: isLive
                ? "3px solid var(--accent)"
                : "3px solid transparent",
              borderBottom: "1px solid var(--border)",
              opacity: isFuture ? 0.4 : 1,
            }}
          >
            <div
              style={{
                fontFamily: mono,
                fontSize: 10,
                color: "var(--grey-555)",
                width: 12,
                flexShrink: 0,
              }}
            >
              {e.channel}
            </div>
            <div
              style={{
                fontFamily: mono,
                fontSize: 11,
                color: isLive ? "var(--accent)" : "var(--grey-666)",
                width: 58,
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              {fmtClock(e.broadcast.start_timestamp, use12h)}
            </div>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text)",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {cleanTitle}
            </div>
            {isRepeat && <RepeatIcon />}
            {url && (
              <div
                onClick={() => window.nts.openUrl(url)}
                style={{
                  fontFamily: mono,
                  fontSize: 9,
                  color: "var(--grey-888)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 3,
                  padding: "1px 5px",
                  opacity: 0.6,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                Link
              </div>
            )}
            <div
              onClick={() => onToggleFavorite(e.alias)}
              style={{
                fontSize: 13,
                color: "var(--accent)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              &#9733;
            </div>
          </div>
        );
      })}
    </div>
  );
};

const SettingsToggle = ({ label, checked, onChange, disabled }) => (
  <div
    onClick={() => !disabled && onChange(!checked)}
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "12px 16px",
      borderBottom: "1px solid var(--border)",
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.4 : 1,
    }}
  >
    <span style={{ fontSize: 13, color: "var(--text)" }}>{label}</span>
    <div
      style={{
        width: 28,
        height: 15,
        borderRadius: 8,
        background: checked ? "var(--accent)" : "var(--border-strong)",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 1.5,
          left: checked ? 14.5 : 1.5,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "#fff",
        }}
      />
    </div>
  </div>
);

const SettingsView = ({ prefs, onUpdatePref }) => {
  const [settings, setSettings] = useState({
    pinnedToDesktop: false,
    launchAtLogin: false,
    launchAtLoginAvailable: false,
    showInDock: true,
  });

  useEffect(() => {
    window.nts.getSettings().then(setSettings);
    window.nts.onSettingsChanged(setSettings);
  }, []);

  return (
    <div style={{ height: 300, overflowY: "auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 13, color: "var(--text)" }}>Appearance</span>
        <div
          style={{ display: "flex", gap: 6, fontFamily: mono, fontSize: 10 }}
        >
          {[
            ["dark", "DARK"],
            ["light", "LIGHT"],
            ["auto", "AUTO"],
          ].map(([key, label]) => (
            <div
              key={key}
              onClick={() => onUpdatePref("theme", key)}
              style={{
                padding: "4px 8px",
                borderRadius: 3,
                color: prefs.theme === key ? "#fff" : "var(--grey-666)",
                background:
                  prefs.theme === key ? "var(--accent)" : "var(--surface)",
                cursor: "pointer",
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 13, color: "var(--text)" }}>Accent Color</span>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          {ACCENT_PRESETS.map((c) => (
            <div
              key={c}
              onClick={() => onUpdatePref("accentColor", c)}
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: c,
                border:
                  prefs.accentColor === c
                    ? "2px solid var(--text)"
                    : "1px solid var(--border-strong)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            />
          ))}
          <input
            type="color"
            value={prefs.accentColor}
            onChange={(e) => onUpdatePref("accentColor", e.target.value)}
            style={{
              width: 16,
              height: 16,
              padding: 0,
              border: "none",
              background: "none",
              cursor: "pointer",
            }}
          />
        </div>
      </div>
      <SettingsToggle
        label="Notifications"
        checked={prefs.notificationsEnabled}
        onChange={(v) => onUpdatePref("notificationsEnabled", v)}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 13, color: "var(--text)" }}>
          Default Channel on Launch
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {["1", "2"].map((ch) => (
            <div
              key={ch}
              onClick={() => onUpdatePref("defaultChannel", ch)}
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: mono,
                fontSize: 12,
                color:
                  prefs.defaultChannel === ch
                    ? "var(--text)"
                    : "var(--grey-666)",
                background:
                  prefs.defaultChannel === ch
                    ? "var(--accent)"
                    : "var(--surface)",
                cursor: "pointer",
              }}
            >
              {ch}
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 13, color: "var(--text)" }}>Time Format</span>
        <div
          style={{ display: "flex", gap: 6, fontFamily: mono, fontSize: 10 }}
        >
          {[
            ["24h", "24H"],
            ["12h", "12H"],
          ].map(([key, label]) => (
            <div
              key={key}
              onClick={() => onUpdatePref("timeFormat", key)}
              style={{
                padding: "4px 8px",
                borderRadius: 3,
                color:
                  prefs.timeFormat === key ? "var(--text)" : "var(--grey-666)",
                background:
                  prefs.timeFormat === key ? "var(--accent)" : "var(--surface)",
                cursor: "pointer",
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
      <SettingsToggle
        label="Auto-Resume Last Station"
        checked={prefs.autoResumeLastStation}
        onChange={(v) => onUpdatePref("autoResumeLastStation", v)}
      />
      <SettingsToggle
        label="Show Now Playing in Menu Bar"
        checked={prefs.showNowPlayingInMenuBar}
        onChange={(v) => onUpdatePref("showNowPlayingInMenuBar", v)}
      />
      <SettingsToggle
        label="Pin to Desktop (locks position)"
        checked={settings.pinnedToDesktop}
        onChange={(v) => window.nts.setPinnedToDesktop(v)}
      />
      <SettingsToggle
        label={
          settings.launchAtLoginAvailable
            ? "Launch at Login"
            : "Launch at Login (requires packaged build)"
        }
        checked={settings.launchAtLogin}
        onChange={(v) => window.nts.setLaunchAtLogin(v)}
        disabled={!settings.launchAtLoginAvailable}
      />
      <SettingsToggle
        label="Show in Dock"
        checked={settings.showInDock}
        onChange={(v) => window.nts.setShowInDock(v)}
      />
      <div
        onClick={() => window.nts.quitApp()}
        style={{
          padding: "14px 16px",
          fontFamily: mono,
          fontSize: 11,
          color: "var(--accent)",
          letterSpacing: 0.5,
          textTransform: "uppercase",
          cursor: "pointer",
        }}
      >
        Quit NTS Widget
      </div>
    </div>
  );
};

const Footer = ({ view, onSetView }) => (
  <div style={{ display: "flex", borderTop: "1px solid var(--border)" }}>
    {[
      { key: "schedule", label: "SCHEDULE" },
      { key: "favorites", label: "FAVORITES" },
    ].map((t) => (
      <div
        key={t.key}
        onClick={() => onSetView(t.key)}
        style={{
          flex: 1,
          textAlign: "center",
          padding: "10px 0",
          fontFamily: mono,
          fontSize: 10,
          letterSpacing: 1,
          color: view === t.key ? "var(--text)" : "var(--grey-555)",
          cursor: "pointer",
          borderTop:
            view === t.key
              ? "2px solid var(--accent)"
              : "2px solid transparent",
          marginTop: -1,
        }}
      >
        {t.label}
      </div>
    ))}
    <div
      onClick={() => onSetView("settings")}
      style={{
        width: 50,
        textAlign: "center",
        padding: "8px 0",
        fontSize: 14,
        color: view === "settings" ? "var(--accent)" : "var(--grey-555)",
        cursor: "pointer",
        borderTop:
          view === "settings"
            ? "2px solid var(--accent)"
            : "2px solid transparent",
        marginTop: -1,
      }}
    >
      &#9881;
    </div>
  </div>
);

const SLEEP_OPTIONS = [null, 15, 30, 60, 120, 180];
const formatSleepLabel = (minutes) =>
  minutes < 60 ? `${minutes}m` : `${minutes / 60}h`;

const App = () => {
  const [prefs, setPrefs] = useState(loadPrefs);
  const [activeChannel, setActiveChannel] = useState(
    () => loadPrefs().defaultChannel,
  );
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [liveNow, setLiveNow] = useState(null);
  const [playingChannel, setPlayingChannel] = useState(null);
  const [sleepMinutes, setSleepMinutes] = useState(null);
  const [favorites, setFavorites] = useState(loadFavorites);
  const [footerView, setFooterView] = useState("schedule");
  const [pinnedToDesktop, setPinnedToDesktopState] = useState(false);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const audioRef = useRef(null);
  const sleepTimeoutRef = useRef(null);
  const prevTitleRef = useRef({});
  if (!audioRef.current) {
    audioRef.current = new Audio();
    audioRef.current.addEventListener("error", () => setPlayingChannel(null));
  }

  const updatePref = (key, value) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      savePrefs(next);
      return next;
    });
  };

  const clearSleepTimer = () => {
    if (sleepTimeoutRef.current) {
      clearTimeout(sleepTimeoutRef.current);
      sleepTimeoutRef.current = null;
    }
    setSleepMinutes(null);
  };

  const stopPlaying = () => {
    audioRef.current.pause();
    audioRef.current.removeAttribute("src");
    setPlayingChannel(null);
    clearSleepTimer();
  };

  const togglePlay = (channel) => {
    const audio = audioRef.current;
    if (playingChannel === channel) {
      stopPlaying();
    } else {
      audio.src = STREAM_URLS[channel];
      audio.play().catch(() => setPlayingChannel(null));
      setPlayingChannel(channel);
      localStorage.setItem(LAST_CHANNEL_KEY, channel);
    }
  };

  const toggleFavorite = (showAlias) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(showAlias)) next.delete(showAlias);
      else next.add(showAlias);
      saveFavorites(next);
      return next;
    });
  };

  const cycleSleep = () => {
    const idx = SLEEP_OPTIONS.indexOf(sleepMinutes);
    const next = SLEEP_OPTIONS[(idx + 1) % SLEEP_OPTIONS.length];
    if (sleepTimeoutRef.current) clearTimeout(sleepTimeoutRef.current);
    setSleepMinutes(next);
    if (next) {
      sleepTimeoutRef.current = setTimeout(stopPlaying, next * 60000);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetchSchedules()
        .then((d) => {
          if (!cancelled) {
            setData(d);
            setError(false);
          }
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    };
    tick();
    const id = setInterval(tick, 300000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetchLive()
        .then((d) => {
          if (!cancelled) setLiveNow(d);
        })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Media-key play/pause (registered in main) toggles whichever channel is
  // currently active in the UI.
  useEffect(() => {
    window.nts.onTogglePlayShortcut(() => togglePlay(activeChannel));
  }, [activeChannel, playingChannel]);

  // Tray "Play NTS 1/2" and "Stop" menu items drive the same togglePlay/
  // stopPlaying used everywhere else in the UI.
  useEffect(() => {
    window.nts.onPlayChannel((channel) => {
      if (channel === null) stopPlaying();
      else togglePlay(channel);
    });
  }, [playingChannel]);

  useEffect(() => {
    window.nts.onOpenSettings(() => setFooterView("settings"));
  }, []);

  // Pin to Desktop needs to disable the drag region too, otherwise the
  // window still moves via its own drag strip even though it's "locked".
  useEffect(() => {
    window.nts
      .getSettings()
      .then((s) => setPinnedToDesktopState(s.pinnedToDesktop));
    window.nts.onSettingsChanged((s) =>
      setPinnedToDesktopState(s.pinnedToDesktop),
    );
  }, []);

  // Keeps "Auto" theme in sync if the user flips macOS's own appearance
  // setting while the widget is open.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e) => setSystemPrefersDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const activeTheme =
    prefs.theme === "auto"
      ? systemPrefersDark
        ? "dark"
        : "light"
      : prefs.theme;
  const themeVars = THEME_VARS[activeTheme];
  // The "white" accent preset is really "monochrome" — resolve it to
  // whatever the current theme's own text color is, so it's never an
  // invisible white-on-white (or black-on-black) accent.
  const resolvedAccent =
    prefs.accentColor === "#ffffff" ? themeVars["--text"] : prefs.accentColor;

  // Mirrors playingChannel to main so the tray menu can show which channel
  // (if any) is checked.
  useEffect(() => {
    window.nts.setPlayingChannel(playingChannel);
  }, [playingChannel]);

  // Resume whatever was last streaming, once, on launch.
  useEffect(() => {
    if (prefs.autoResumeLastStation) {
      const last = localStorage.getItem(LAST_CHANNEL_KEY);
      if (last) togglePlay(last);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tray title mirrors whatever's actually streaming, blank if nothing is
  // (or if the user's turned the menu bar text off in Settings).
  useEffect(() => {
    if (
      prefs.showNowPlayingInMenuBar &&
      playingChannel &&
      liveNow &&
      liveNow[`ch${playingChannel}`]
    ) {
      window.nts.setTrayTitle(
        formatTrayTitle(
          liveNow[`ch${playingChannel}`].broadcast_title,
          playingChannel,
        ),
      );
    } else {
      window.nts.setTrayTitle("");
    }
  }, [playingChannel, liveNow, prefs.showNowPlayingInMenuBar]);

  // Notify when the show on the tab you're looking at changes.
  useEffect(() => {
    if (!prefs.notificationsEnabled) return;
    if (!liveNow) return;
    const now = liveNow[`ch${activeChannel}`];
    if (!now) return;
    const prev = prevTitleRef.current[activeChannel];
    if (prev && prev !== now.broadcast_title) {
      new Notification(
        `NTS ${activeChannel}: ${parseRepeatTitle(now.broadcast_title).title}`,
        {
          body:
            (now.embeds &&
              now.embeds.details &&
              now.embeds.details.location_long) ||
            "",
        },
      );
    }
    prevTitleRef.current[activeChannel] = now.broadcast_title;
  }, [liveNow, activeChannel, prefs.notificationsEnabled]);

  return (
    <div
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        maxHeight: "100vh",
        overflowX: "hidden",
        overflowY: "auto",
        ...themeVars,
        "--accent": resolvedAccent,
      }}
    >
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
        .pulse-dot { animation: pulse 1.6s ease-in-out infinite; }
      `}</style>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 16,
          WebkitAppRegion: pinnedToDesktop ? "no-drag" : "drag",
          cursor: pinnedToDesktop ? "default" : "grab",
        }}
      >
        <div style={{ display: "flex", gap: 3 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: 3,
                height: 3,
                borderRadius: "50%",
                background: "var(--border-strong)",
              }}
            />
          ))}
        </div>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        {["1", "2"].map((ch) => (
          <div
            key={ch}
            onClick={() => setActiveChannel(ch)}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "14px 0",
              fontFamily: mono,
              fontSize: 28,
              fontWeight: 700,
              color: activeChannel === ch ? "var(--text)" : "var(--grey-444)",
              borderBottom:
                activeChannel === ch
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
              cursor: "pointer",
              WebkitAppRegion: "no-drag",
            }}
          >
            {ch}
          </div>
        ))}
      </div>
      <NowPlaying
        now={liveNow && liveNow[`ch${activeChannel}`]}
        isPlaying={playingChannel === activeChannel}
        onTogglePlay={() => togglePlay(activeChannel)}
        favorites={favorites}
        onToggleFavorite={toggleFavorite}
        sleepMinutes={sleepMinutes}
        onCycleSleep={cycleSleep}
        use12h={prefs.timeFormat === "12h"}
      />
      {footerView === "schedule" && (
        <>
          <ChannelPane
            data={data && data.ch1}
            active={activeChannel === "1"}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            notificationsEnabled={prefs.notificationsEnabled}
            use12h={prefs.timeFormat === "12h"}
          />
          <ChannelPane
            data={data && data.ch2}
            active={activeChannel === "2"}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            notificationsEnabled={prefs.notificationsEnabled}
            use12h={prefs.timeFormat === "12h"}
          />
        </>
      )}
      {footerView === "favorites" && (
        <FavoritesView
          data={data}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          use12h={prefs.timeFormat === "12h"}
        />
      )}
      {footerView === "settings" && (
        <SettingsView prefs={prefs} onUpdatePref={updatePref} />
      )}
      {error && (
        <div
          style={{
            padding: "6px 16px",
            fontSize: 9,
            color: "#552",
            fontFamily: mono,
          }}
        >
          fetch error &mdash; showing last known data
        </div>
      )}
      <Footer view={footerView} onSetView={setFooterView} />
    </div>
  );
};

createRoot(document.getElementById("root")).render(<App />);
