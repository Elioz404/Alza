/** Activity feed — every tool call (human or agent) is visible on the page. */

import { useEffect, useRef } from "react";
import { useAppStore } from "../model/store";

export function ActivityFeed() {
  const activity = useAppStore((s) => s.activity);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [activity.length]);

  return (
    <div className="activity-feed" ref={ref}>
      {activity.length === 0 && <div className="activity-empty">Tool activity will appear here — yours and your agent's.</div>}
      {activity.map((a) => (
        <div key={a.id} className={`activity-row ${a.source} ${a.ok ? "" : "failed"}`}>
          <span className={`activity-badge ${a.source}`}>
            {a.source === "agent" ? "AGENT" : a.source === "human" ? "YOU" : "SYS"}
          </span>
          <span className="activity-tool">{a.tool}</span>
          <span className="activity-summary">{a.summary}</span>
          <span className="activity-time">
            {new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>
      ))}
    </div>
  );
}
