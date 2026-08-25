// Keeping a rendered match in step with the transform console.
//
// Renders are prepared ahead of being needed, because the two things that use them
// cannot wait: an OS drag hands over a path the moment it starts, and a pitch shift
// has no realtime equivalent to fall back on. Settings changes are debounced, since
// dragging a tempo field through twenty values should render the twentieth.

import { useCallback, useEffect, useRef, useState } from "react";
import { matchRenderName, renderMatch } from "./render-match";
import type { MatchRenderRequest, RenderedMatch } from "./render-match";

export type MatchRenderStatus = "idle" | "rendering" | "ready" | "failed";

export type MatchRenderState = {
  /** The render for the current request, or `null` until one exists. */
  render: RenderedMatch | null;
  status: MatchRenderStatus;
  /** Awaits the render for the current request, starting it if it has not begun. */
  ensure: () => Promise<RenderedMatch | null>;
};

/** How long the settings must hold still before rendering. */
const SETTLE_MS = 400;

/** `request` must be memoized by the caller: it is an effect dependency. */
export function useMatchRender(request: MatchRenderRequest | null): MatchRenderState {
  // Held with the name it belongs to rather than cleared when the name changes, so
  // no state has to be set while rendering — a result for a name we have moved on
  // from is simply not the current one.
  const [settled, setSettled] = useState<{ name: string; render: RenderedMatch | null } | null>(null);

  const name = request ? matchRenderName(request) : "";
  const current = settled?.name === name ? settled : null;

  // Read by `ensure`, which is called from click handlers rather than during a
  // render, so it must not be rebuilt on every keystroke in the console — a handler
  // holding a stale copy would render a transform the user has already replaced.
  const latest = useRef<MatchRenderRequest | null>(request);
  useEffect(() => {
    latest.current = request;
  }, [request]);

  useEffect(() => {
    if (!request) return undefined;

    let live = true;
    const timer = window.setTimeout(() => {
      renderMatch(request).then((render) => {
        if (live) setSettled({ name, render });
      });
    }, SETTLE_MS);

    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // Keyed on the name as well as the object: the name *is* the request — same
    // slice, same transform — and it is what the result is filed under.
  }, [name, request]);

  const ensure = useCallback(async () => {
    const pending = latest.current;
    if (!pending) return null;

    const pendingName = matchRenderName(pending);
    const render = await renderMatch(pending);
    // A slow render finishing after the user moved on must not become the state,
    // which the name guard in the reader already handles — but recording it keeps
    // the console from saying "rendering" forever if nothing else changes.
    setSettled({ name: pendingName, render });
    return render;
  }, []);

  return {
    render: current?.render ?? null,
    status: !request ? "idle" : !current ? "rendering" : current.render ? "ready" : "failed",
    ensure,
  };
}
