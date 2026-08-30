/* ═══════════════════════════════════════════════════════════════
   PCB TRACES

   Nets enter from off the left of the sheet and fan out across the
   page in 45/90-degree runs, terminating in pads. There is no spine
   bus. The head follows the reading position: copper grows in on the
   way down and cuts out on the way up. The canvas is the sheet itself
   and scrolls with the document; JS only paints while copper is moving.
   ═══════════════════════════════════════════════════════════════ */

(() => {
  const canvas = document.querySelector(".pcb");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── Look ── */
  /* Opaque, so overlapping copper never doubles up in tone. Both greys are
     what the old translucent copper composited to over the paper. */
  const COPPER = "#f6f6f6";
  const PAD = "#dddddd";

  const FAN_W = 2;
  const RETRACT_TRIGGER = 60;

  const CELL = 5; // occupancy grid resolution; also the copper clearance
  const EDGE = 48; // traces begin this many px past the left of the viewport

  /* ── State ── */
  let dpr = 1,
    vw = 0,
    vh = 0,
    docH = 0;
  let traces = [];
  let board = { y0: 0, y1: 0 };
  let occ = null,
    cols = 0,
    rows = 0;
  let seed = 0x51ed;
  let tip = 0,
    lastTip = 0,
    retracted = 0;
  let running = false,
    enabled = true,
    lastT = 0;

  /* ─────────────────── PRNG ─────────────────── */

  function prng(s) {
    let a = s >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ─────────────────── Occupancy ─────────────────── */

  const idx = (cx, cy) => cy * cols + cx;
  const cellX = (x) => Math.floor((x + EDGE) / CELL);
  const cellY = (y) => Math.floor(y / CELL);

  /* Cells a polyline passes through. Only consecutive repeats are collapsed;
     a path that doubles back over its own cell just gets checked twice, which
     is cheaper than hashing every cell to dedupe globally. */
  function cellsOf(pts) {
    const out = [];
    let last = -1;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const steps = Math.max(
        1,
        Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL / 2)),
      );
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const cx = cellX(ax + (bx - ax) * t);
        const cy = cellY(ay + (by - ay) * t);
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return null;
        const k = idx(cx, cy);
        if (k !== last) {
          last = k;
          out.push([cx, cy]);
        }
      }
    }
    return out;
  }

  /* Occupancy exemptions at a T-junction: only the host net's cells inside
     the disc. A geometric disc would also punch a hole in sibling copper
     and let two forks sit on top of each other. */
  function joinCells(hostPts, x, y, r) {
    const disc = junctionAt(x, y, r);
    const host = cellsOf(hostPts);
    const out = new Set();
    if (!host) return disc;
    for (const [cx, cy] of host) {
      const i = idx(cx, cy);
      if (disc.has(i)) out.add(i);
    }
    return out;
  }

  function junctionAt(x, y, r) {
    const out = new Set();
    const r2 = r * r;
    const x0 = Math.max(0, cellX(x - r));
    const x1 = Math.min(cols - 1, cellX(x + r));
    const y0 = Math.max(0, cellY(y - r));
    const y1 = Math.min(rows - 1, cellY(y + r));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const dx = (cx + 0.5) * CELL - EDGE - x;
        const dy = (cy + 0.5) * CELL - y;
        if (dx * dx + dy * dy <= r2) out.add(idx(cx, cy));
      }
    }
    return out;
  }

  /* Free with a one-cell buffer, so unrelated traces never touch. `along`
     is the T-junction disc; those cells may sit on the parent. `pending`
     is exact-cell only so parallel bundle lanes at one-pitch spacing pass. */
  function cellsFree(grid, cells, along, pending) {
    for (const [cx, cy] of cells) {
      const i = idx(cx, cy);
      if (along && along.has(i)) continue;
      if (pending && pending.has(i)) return false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx,
            ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = idx(nx, ny);
          if (along && along.has(ni)) continue;
          if (grid[ni]) return false;
        }
      }
    }
    return true;
  }

  function commit(grid, cells) {
    for (const [cx, cy] of cells) grid[idx(cx, cy)] = 1;
  }

  /* Intersection point of two segments, or null. Includes T-joins
     (endpoint on the other's interior). A takeoff that only shares its
     origin is filtered by the caller. */
  function segHit(a, b, c, d) {
    const ax = b[0] - a[0],
      ay = b[1] - a[1];
    const cx = d[0] - c[0],
      cy = d[1] - c[1];
    const den = ax * cy - ay * cx;
    if (Math.abs(den) < 1e-6) {
      /* Parallel: collinear overlap counts as a hit at the overlap start */
      const cross = (c[0] - a[0]) * ay - (c[1] - a[1]) * ax;
      if (Math.abs(cross) > 1.2) return null;
      const ab = ax * ax + ay * ay;
      if (ab < 1) return null;
      const t0 = ((c[0] - a[0]) * ax + (c[1] - a[1]) * ay) / ab;
      const t1 = ((d[0] - a[0]) * ax + (d[1] - a[1]) * ay) / ab;
      const lo = Math.max(0, Math.min(t0, t1));
      const hi = Math.min(1, Math.max(t0, t1));
      if (hi - lo < 0.04) return null;
      return [a[0] + ax * lo, a[1] + ay * lo];
    }
    const t = ((c[0] - a[0]) * cy - (c[1] - a[1]) * cx) / den;
    const u = ((c[0] - a[0]) * ay - (c[1] - a[1]) * ax) / den;
    if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) return null;
    return [a[0] + ax * t, a[1] + ay * t];
  }

  function polyCrosses(a, b, origin) {
    for (let i = 1; i < a.length; i++) {
      const p = a[i - 1],
        q = a[i];
      for (let j = 1; j < b.length; j++) {
        const hit = segHit(p, q, b[j - 1], b[j]);
        if (!hit) continue;
        if (origin && Math.hypot(hit[0] - origin[0], hit[1] - origin[1]) < 12)
          continue;
        return true;
      }
    }
    return false;
  }

  /* T-junctions are legal only against `parentPts`. Every other net is a
     hard crossing — including a sibling that leaves the same parent nearby. */
  function hitsCopper(pts, extra, parentPts) {
    const origin = pts[0];
    for (const t of traces) {
      const join = parentPts && t.pts === parentPts ? origin : null;
      if (polyCrosses(pts, t.pts, join)) return true;
    }
    if (extra) {
      for (const t of extra) {
        if (polyCrosses(pts, t.pts, null)) return true;
      }
    }
    return false;
  }

  function accept(pts, pending, extra, parentPts) {
    const origin = pts[0];
    const along = parentPts
      ? joinCells(parentPts, origin[0], origin[1], 12)
      : null;
    const cells = cellsOf(pts);
    if (!cells || !cellsFree(occ, cells, along, pending)) return null;
    if (hitsCopper(pts, extra, parentPts || null)) return null;
    return cells;
  }

  /* ─────────────────── Routing ─────────────────── */

  function polyLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) {
      L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    return L;
  }

  /* Per-net clock: copper speed in px/ms plus a start lag, so two traces
     that enter together still finish on different frames.
     A fork also stores its parent and the arc length along that parent
     where it takes off — it must not draw until copper has reached there. */
  function stamp(pts, rnd, parent, along) {
    const branched = !!parent;
    return {
      pts,
      len: Math.max(1, polyLength(pts)),
      startY: pts[0][1],
      progress: 0,
      wait: 0,
      lag: branched ? rnd() * 60 : 50 + rnd() * 780,
      rate: 0.05 + rnd() * 0.16,
      parent: parent || null,
      along: along || 0,
    };
  }

  function lengthTo(pts, x, y) {
    let L = 0,
      best = 0,
      bestD = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const seg = Math.hypot(bx - ax, by - ay);
      const t =
        seg === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (seg * seg),
              ),
            );
      const d = Math.hypot(x - (ax + (bx - ax) * t), y - (ay + (by - ay) * t));
      if (d < bestD) {
        bestD = d;
        best = L + seg * t;
      }
      L += seg;
    }
    return best;
  }

  function headingOf(dx, dy) {
    if (Math.abs(dy) < 0.6 && dx > 0.6) return "right";
    if (Math.abs(dx) < 0.6 && dy > 0.6) return "down";
    if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.6 && dy > 0.6) {
      return dx > 0.6 ? "diag" : dx < -0.6 ? "diagL" : null;
    }
    return null;
  }

  /* A net. Never turns 90°. From a vertical, 45° is legal both right and left.
     If targetX is set, the run keeps gaining width until it lands in that
     band — 50–90% of the window for primary traces. */
  function spine(
    x0,
    y0,
    rnd,
    maxX,
    yHi,
    heading = "diag",
    legs = null,
    scale = 1,
    targetX = null,
  ) {
    const pts = [[x0, y0]];
    let cx = x0,
      cy = y0;
    const n =
      targetX != null ? 26 : legs != null ? legs : 5 + Math.floor(rnd() * 6);
    const s = scale;
    const minX = 8;
    const legal = {
      right: ["right", "diag"],
      down: ["down", "diag", "diagL"],
      diag: ["right", "diag", "down"],
      diagL: ["down", "diagL"],
    };

    for (let i = 0; i < n; i++) {
      if (targetX != null && cx >= targetX && i >= 2) break;
      const opts = legal[heading];
      if (!opts) break;
      let nx = cx,
        ny = cy,
        next = heading,
        ok = false;
      const needX = targetX != null && cx < targetX;

      for (let t = 0; t < 6 && !ok; t++) {
        /* First pick drops the current heading from the pool, so a run bends
           at almost every leg instead of stacking collinear ones. */
        if (needX && t === 0) {
          const gain = opts.filter((o) => o === "right" || o === "diag");
          const turn = gain.filter((o) => o !== heading);
          const pool = turn.length && rnd() < 0.8 ? turn : gain;
          next = pool.length ? pool[Math.floor(rnd() * pool.length)] : opts[0];
        } else if (t === 0) {
          const turn = opts.filter((o) => o !== heading);
          const pool = turn.length && rnd() < 0.85 ? turn : opts;
          next = pool[Math.floor(rnd() * pool.length)];
        } else {
          next = opts[t % opts.length];
        }
        nx = cx;
        ny = cy;

        if (next === "right") {
          const room = maxX - cx - 8;
          const span = needX
            ? Math.max(targetX - cx, 60)
            : (44 + rnd() * 150) * s;
          nx =
            cx +
            Math.min(
              span * (needX ? 0.22 + rnd() * 0.3 : 0.45 + rnd() * 0.55),
              room,
            );
        } else if (next === "down") {
          ny = cy + Math.max(16, (22 + rnd() * 74) * s);
        } else if (next === "diagL") {
          const d = Math.min(
            Math.max(14, (18 + rnd() * 60) * s),
            cx - minX - 8,
          );
          nx = cx - d;
          ny = cy + d;
        } else {
          const room = maxX - cx - 8;
          const d = Math.min(
            Math.max(14, (needX ? 26 + rnd() * 84 : 18 + rnd() * 62) * s),
            room,
          );
          nx = cx + d;
          ny = cy + d;
        }
        ok =
          nx >= minX &&
          nx <= maxX &&
          ny <= yHi &&
          Math.hypot(nx - cx, ny - cy) > 12;
      }
      if (!ok) break;

      pts.push([nx, ny]);
      cx = nx;
      cy = ny;
      heading = next;
    }
    return pts.length > 1 ? pts : null;
  }

  /* If two axis-aligned legs meet at 90°, replace the corner with a 45
     chamfer so a truncated or offset copy can never keep a square bend. */
  function chamfer90(pts, cut) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const [cx, cy] = pts[i + 1];
      const inLen = Math.hypot(bx - ax, by - ay);
      const outLen = Math.hypot(cx - bx, cy - by);
      const dx1 = inLen ? (bx - ax) / inLen : 0,
        dy1 = inLen ? (by - ay) / inLen : 0;
      const dx2 = outLen ? (cx - bx) / outLen : 0,
        dy2 = outLen ? (cy - by) / outLen : 0;
      const axisIn = Math.abs(dx1) < 0.02 || Math.abs(dy1) < 0.02;
      const axisOut = Math.abs(dx2) < 0.02 || Math.abs(dy2) < 0.02;
      const square = Math.abs(dx1 * dx2 + dy1 * dy2) < 0.15;
      const d = Math.min(cut, inLen * 0.45, outLen * 0.45);
      if (axisIn && axisOut && square && d > 2) {
        out.push([bx - dx1 * d, by - dy1 * d]);
        out.push([bx + dx2 * d, by + dy2 * d]);
      } else {
        out.push([bx, by]);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  /* A child net leaving a parent. First leg is always 45° off the parent's
     heading, so the fork is never a square T. */
  function branchOffAt(x0, y0, h, rnd, maxX, yHi, depth) {
    if (!h) return null;
    const s = 0.32 + depth * 0.14;
    const d = Math.max(14, ((16 + rnd() * 44) * s) / 0.5);
    let x1 = x0,
      y1 = y0,
      heading = h;
    if (h === "right") {
      x1 = x0 + d;
      y1 = y0 + d;
      heading = "diag";
    } else if (h === "down") {
      y1 = y0 + d;
      if (rnd() < 0.5 && x0 - d >= 8) {
        x1 = x0 - d;
        heading = "diagL";
      } else {
        x1 = x0 + d;
        heading = "diag";
      }
    } else if (h === "diagL") {
      y1 = y0 + Math.max(16, ((24 + rnd() * 70) * s) / 0.5);
      heading = "down";
    } else if (rnd() < 0.58) {
      x1 = x0 + Math.max(16, ((24 + rnd() * 70) * s) / 0.5);
      heading = "right";
    } else {
      y1 = y0 + Math.max(16, ((24 + rnd() * 70) * s) / 0.5);
      heading = "down";
    }
    if (
      x1 > maxX ||
      x1 < 8 ||
      y1 > yHi ||
      y1 < board.y0 + 8 ||
      (x1 === x0 && y1 === y0)
    )
      return null;

    const rest = spine(
      x1,
      y1,
      rnd,
      maxX,
      yHi,
      heading,
      2 + Math.floor(rnd() * 4),
      s,
    );
    return chamfer90(
      rest && rest.length > 1
        ? [[x0, y0], ...rest]
        : [
            [x0, y0],
            [x1, y1],
          ],
      14,
    );
  }

  /* Vertices plus mid-leg sites, so a long straight on the main run can
     still grow a row of stubs instead of waiting for a corner. */
  function forkSites(pts) {
    const sites = [];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const h = headingOf(bx - ax, by - ay);
      if (!h) continue;
      const len = Math.hypot(bx - ax, by - ay);
      const first = i === 1;
      const last = i === pts.length - 1;
      const t0 = first ? 0.38 : 0.12;
      const t1 = last ? 0.62 : 0.88;
      const n = Math.max(1, Math.floor(len / 56));
      for (let k = 0; k < n; k++) {
        const t = n === 1 ? (t0 + t1) / 2 : t0 + (t1 - t0) * (k / (n - 1));
        sites.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, h });
      }
      if (!last && len > 18) sites.push({ x: bx, y: by, h });
    }
    return sites;
  }

  function sprout(parent, rnd, maxX, yHi, depth) {
    const pts = parent.pts;
    if (depth <= 0 || pts.length < 2 || parent.len < 36) return;
    const sites = forkSites(pts);
    if (!sites.length) return;
    const want =
      depth >= 2 ? 3 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 2);
    const used = new Set();
    for (let a = 0; a < want * 8 && used.size < want; a++) {
      const s = sites[Math.floor(rnd() * sites.length)];
      const key = ((s.x / 28) | 0) + ":" + ((s.y / 28) | 0);
      if (used.has(key)) continue;
      used.add(key);
      const childPts = branchOffAt(s.x, s.y, s.h, rnd, maxX, yHi, depth);
      if (!childPts || childPts.length < 2) continue;
      const cells = accept(childPts, null, null, pts);
      if (!cells) continue;
      commit(occ, cells);
      const child = stamp(childPts, rnd, parent, lengthTo(pts, s.x, s.y));
      traces.push(child);
      sprout(child, rnd, maxX, yHi, depth - 1);
    }
  }

  /* Lay a bundle that enters from off the left of the viewport.

     Members arrive on 45-degree diagonals, from takeoffs spaced two pitches
     apart, and converge into parallel lanes one pitch apart. The lanes then
     follow a shared spine — offsetting each lane by (+gap, -gap) is
     perpendicular to a 45-degree leg and keeps spacing through every bend. */
  function bundle(anchorY, size, gap, rnd, maxX, yHi) {
    const x0 = 8 - EDGE;
    const inbound = [32 + rnd() * 28, anchorY + 18 + rnd() * 24];
    const farX = vw * (0.86 + rnd() * 0.08);
    const sp = spine(
      inbound[0],
      inbound[1],
      rnd,
      maxX,
      yHi,
      "diag",
      null,
      1,
      farX,
    );
    if (!sp) return null;

    const runs = [];
    const pending = new Set();

    for (let k = 0; k < size; k++) {
      const lane = [inbound[0] + k * gap, inbound[1] - k * gap];
      const yStart = lane[1] - (lane[0] - x0);
      if (yStart < 4 || yStart > yHi - 8) continue;

      const stopX =
        vw *
        (size === 1
          ? 0.5 + rnd() * 0.4
          : 0.5 + (k / (size - 1)) * 0.4 + (rnd() - 0.5) * 0.05);

      const pts = [[x0, yStart], lane];
      for (let j = 1; j < sp.length; j++) {
        const ax = sp[j - 1][0] + k * gap,
          ay = sp[j - 1][1] - k * gap;
        const bx2 = sp[j][0] + k * gap,
          by2 = sp[j][1] - k * gap;
        if (bx2 >= stopX && bx2 !== ax) {
          const t = Math.max(0, Math.min(1, (stopX - ax) / (bx2 - ax)));
          const px = ax + (bx2 - ax) * t;
          const py = ay + (by2 - ay) * t;
          if (
            Math.hypot(
              px - pts[pts.length - 1][0],
              py - pts[pts.length - 1][1],
            ) > 1
          ) {
            pts.push([px, py]);
          }
          break;
        }
        if (
          Math.hypot(
            bx2 - pts[pts.length - 1][0],
            by2 - pts[pts.length - 1][1],
          ) > 1
        ) {
          pts.push([bx2, by2]);
        }
      }

      /* Peel away rather than just stopping. */
      if (pts.length >= 2 && rnd() < 0.55) {
        const [lx, ly] = pts[pts.length - 1];
        const d = 20 + rnd() * 36;
        const lastH = headingOf(
          lx - pts[pts.length - 2][0],
          ly - pts[pts.length - 2][1],
        );
        if (lastH === "down" && rnd() < 0.5 && lx - d >= 8 && ly + d <= yHi) {
          pts.push([lx - d, ly + d]);
        } else if (lx + d <= maxX && ly + d <= yHi) {
          pts.push([lx + d, ly + d]);
        }
      }

      if (pts.length < 2) continue;
      const clean = chamfer90(pts, 18);

      const cells = accept(clean, pending, runs);
      if (!cells) continue;
      for (const [cx, cy] of cells) pending.add(idx(cx, cy));
      runs.push({ pts: clean, cells });
    }
    return runs;
  }

  /* ─────────────────── Board generation ─────────────────── */

  /* Rebuild the occupancy grid. Only copper is tracked — the board renders
     behind the page and is free to run underneath it, so the only thing a
     trace has to keep clear of is other traces. */
  function rebuildOccupancy(keep) {
    occ = new Uint8Array(cols * rows);
    for (const t of keep) {
      const c = cellsOf(t.pts);
      if (c) commit(occ, c);
    }
  }

  function routeBoard(fromY) {
    const rnd = prng(seed++);
    const cut = fromY == null ? board.y0 : fromY;
    const keep = traces.filter((t) => t.startY <= cut);
    rebuildOccupancy(keep);
    traces = keep;

    const maxX = vw - 46;
    let y = Math.max(cut, board.y0) + 20;

    while (y < board.y1 - 24) {
      const gap = 5 + Math.round(rnd() * 3);
      const size = rnd() < 0.08 ? 1 : 3 + Math.floor(rnd() * 10);
      const fan = 2 * (size - 1) * gap;
      const anchor = Math.round(y + fan);
      if (anchor > board.y1 - 16) break;

      let best = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const runs = bundle(anchor, size, gap, rnd, maxX, board.y1);
        if (runs && (!best || runs.length > best.length)) best = runs;
        if (best && best.length === size) break;
      }

      const laid = [];
      for (const { pts, cells } of best || []) {
        commit(occ, cells);
        const run = stamp(pts, rnd);
        traces.push(run);
        laid.push(run);
      }
      for (const run of laid) {
        sprout(run, rnd, maxX, board.y1, 2);
      }

      y = anchor + 3 + rnd() * 12;
    }
  }

  /* ─────────────────── Layout ─────────────────── */

  /* Reading window in document coordinates. visualViewport tracks the iOS
     URL bar without us treating that as a layout resize. */
  function viewRect() {
    const vv = window.visualViewport;
    return {
      top: vv ? vv.pageTop : scrollY,
      h: vv ? vv.height : innerHeight,
    };
  }

  /* iOS blanks canvases past ~16M pixels or 8192px on a side; drop
     backing scale before that. The CSS box still covers the sheet. */
  function backingScale(cssW, cssH) {
    const cap = 16 * 1024 * 1024;
    const maxDim = 8192;
    let s = Math.min(devicePixelRatio || 1, 2);
    const area = Math.max(1, cssW * cssH);
    if (area * s * s > cap) s = Math.sqrt(cap / area);
    if (cssH * s > maxDim) s = maxDim / cssH;
    if (cssW * s > maxDim) s = maxDim / cssW;
    return Math.max(0.25, s);
  }

  function sheetSize() {
    return {
      w: document.documentElement.clientWidth,
      h: Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      ),
    };
  }

  function measure() {
    const next = sheetSize();
    const widthChanged = next.w !== vw;
    const prevY1 = board.y1;
    const hadTraces = traces.length > 0;
    const v = viewRect();

    vw = next.w;
    docH = Math.max(1, next.h);
    vh = v.h;
    dpr = backingScale(vw, docH);

    const bw = Math.max(1, Math.floor(vw * dpr));
    const bh = Math.max(1, Math.floor(docH * dpr));
    /* Reassigning width/height clears the bitmap — only do it when needed. */
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      canvas.style.width = vw + "px";
      canvas.style.height = docH + "px";
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    board.y0 = 0;
    /* Copper runs the whole sheet — stopping at a landmark left the contact
       block and footer bare. */
    board.y1 = Math.max(Math.round(vh), Math.round(docH) - 24);
    cols = Math.ceil((vw + EDGE) / CELL);
    rows = Math.ceil(docH / CELL);

    if (!hadTraces || widthChanged) {
      traces = [];
      routeBoard(board.y0);
      tip = Math.min(Math.max(v.top + v.h * 0.62, board.y0), board.y1);
      lastTip = tip;
      retracted = 0;
    } else if (board.y1 > prevY1 + 8) {
      rebuildOccupancy(traces);
      routeBoard(prevY1);
    }
  }

  /* ─────────────────── Drawing ─────────────────── */

  function line(pathFn, width, colour) {
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    pathFn();
    ctx.stroke();
  }

  function pad(x, y, r, colour) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
  }

  function pathToLength(pts, upto) {
    let left = upto;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length && left > 0; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const seg = Math.hypot(bx - ax, by - ay);
      if (seg <= left) {
        ctx.lineTo(bx, by);
        left -= seg;
      } else {
        const t = left / seg;
        ctx.lineTo(ax + (bx - ax) * t, ay + (by - ay) * t);
        return;
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, vw, docH);
    for (const t of traces) {
      if (t.progress <= 0.001) continue;
      line(() => pathToLength(t.pts, t.len * t.progress), FAN_W, COPPER);
      if (t.progress >= 1) {
        const end = t.pts[t.pts.length - 1];
        pad(end[0], end[1], 3.4, PAD);
      }
    }
  }

  /* ─────────────────── Simulation ─────────────────── */

  function step(dt) {
    const v = viewRect();
    vh = v.h;
    const target = Math.min(Math.max(v.top + v.h * 0.62, board.y0), board.y1);
    tip = target < tip ? target : tip + (target - tip) * Math.min(1, dt / 140);

    let dirty = false;
    let busy = false;
    if (tip < lastTip - 0.5) {
      retracted += lastTip - tip;
    } else if (tip > lastTip + 0.5 && retracted > RETRACT_TRIGGER) {
      routeBoard(v.top + v.h);
      retracted = 0;
      dirty = true;
    }
    lastTip = tip;

    const bottom = v.top + v.h;
    for (const t of traces) {
      const rate = t.rate || 0.1;
      const len = Math.max(1, t.len);
      const alive = t.parent ? t.parent.progress > 0 : t.startY <= bottom;
      const canGrow =
        alive &&
        (t.parent
          ? t.parent.progress * t.parent.len >= t.along - 0.5
          : tip >= t.startY);
      if (canGrow) {
        if ((t.wait || 0) < (t.lag || 0)) {
          t.wait = (t.wait || 0) + dt;
          busy = true;
        } else if (t.progress < 1) {
          t.progress = Math.min(1, t.progress + (dt * rate) / len);
          dirty = true;
        }
      } else if (!alive && (t.progress > 0 || (t.wait || 0) > 0)) {
        t.progress = 0;
        t.wait = 0;
        dirty = true;
      }
    }
    return { busy: busy || dirty, dirty };
  }

  function frame(t) {
    if (!running) return;
    const dt = Math.min(48, t - lastT || 16);
    lastT = t;
    const { busy, dirty } = step(dt);
    if (dirty) draw();
    if (busy) requestAnimationFrame(frame);
    else running = false;
  }

  function wake() {
    if (!enabled || reduced || running) return;
    running = true;
    lastT = performance.now();
    requestAnimationFrame(frame);
  }

  /* ─────────────────── Wiring ─────────────────── */

  let scrollRAF = 0;
  function onScroll() {
    if (reduced) return;
    if (scrollRAF) return;
    scrollRAF = requestAnimationFrame(() => {
      scrollRAF = 0;
      wake();
    });
  }

  function paint() {
    if (reduced) {
      traces.forEach((t) => {
        t.progress = 1;
      });
      draw();
      return;
    }
    draw();
    wake();
  }

  let resizeTimer = 0;
  function onResize() {
    const next = sheetSize();
    /* URL bar show/hide changes innerHeight, not the sheet. Leave the bitmap. */
    if (next.w === vw && Math.abs(next.h - docH) < 8) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      measure();
      paint();
    }, 140);
  }

  function init() {
    measure();
    paint();
  }

  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onResize);
  visualViewport?.addEventListener("scroll", onScroll, { passive: true });
  visualViewport?.addEventListener("resize", onScroll, { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(onResize).observe(document.documentElement);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      measure();
      paint();
    });
  }

  window.PCB = {
    get debug() {
      const legs = { right: 0, diag: 0, down: 0, other: 0 };
      let bad = 0;
      for (const t of traces) {
        const a = t.pts[0],
          b = t.pts[1];
        if (Math.abs(Math.abs(b[0] - a[0]) - Math.abs(b[1] - a[1])) > 0.6)
          bad++;
        for (let i = 1; i < t.pts.length; i++) {
          const dx = t.pts[i][0] - t.pts[i - 1][0],
            dy = t.pts[i][1] - t.pts[i - 1][1];
          if (Math.abs(dy) < 0.01 && dx > 0) legs.right++;
          else if (Math.abs(dx) < 0.01 && dy > 0) legs.down++;
          else if (
            Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.6 &&
            dx > 0 &&
            dy > 0
          )
            legs.diag++;
          else legs.other++;
        }
      }
      const lens = traces.map((t) => Math.round(t.len)).sort((a, b) => a - b);
      return {
        vw,
        traces: traces.length,
        legs,
        nonDiagonalStarts: bad,
        span: board.y1 - board.y0,
        lens,
        median: lens[Math.floor(lens.length / 2)],
        max: lens[lens.length - 1],
      };
    },
    setEnabled(on) {
      enabled = on;
      canvas.style.opacity = on ? "" : "0";
      if (on) {
        measure();
        paint();
      }
    },
    replay() {
      traces.forEach((t) => {
        t.progress = 0;
        t.wait = 0;
      });
      draw();
      wake();
    },
  };

  init();
})();
