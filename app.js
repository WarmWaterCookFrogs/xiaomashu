"use strict";
/* ============ 配置：把腾讯问卷/收集表链接填到引号里，页脚会自动出现反馈入口 ============ */
const FEEDBACK_URL = "";
/* ================= utils ================= */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
// 仅允许 http(s) 链接，阻断 javascript:/data: 等危险协议
const safeUrl = u => { try { const x = new URL(u, location.href); return (x.protocol === "http:" || x.protocol === "https:") ? x.href : null; } catch (e) { return null; } };
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const fmt = n => n >= 10000 ? (n / 1000).toFixed(0) + "k" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const timeStr = ts => { const d = new Date(ts); const p = x => String(x).padStart(2, "0"); return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7.5-4.6-10-9.6C.6 8 2.4 4.5 6 4.5c2.2 0 3.7 1.2 6 3.6 2.3-2.4 3.8-3.6 6-3.6 3.6 0 5.4 3.5 4 6.9-2.5 5-10 9.6-10 9.6z"/></svg>';
const HEART_F = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-10-9.6C.6 8 2.4 4.5 6 4.5c2.2 0 3.7 1.2 6 3.6 2.3-2.4 3.8-3.6 6-3.6 3.6 0 5.4 3.5 4 6.9-2.5 5-10 9.6-10 9.6z"/></svg>';
const MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>';
const MARK_F = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>';
const SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>';
const POSTER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="9" cy="9" r="1.6"/><path d="M20 15l-4-4-7 7"/></svg>';
const LANG_COLORS = { Python: "#3572A5", TypeScript: "#3178c6", JavaScript: "#f1e05a", Go: "#00ADD8", Rust: "#dea584", Java: "#b07219", "C++": "#f34b7d", C: "#555", Swift: "#F05138", Kotlin: "#A97BFF", Ruby: "#701516", PHP: "#4F5D95", "Jupyter Notebook": "#DA5B0B", Shell: "#89e051", HTML: "#e34c26", CSS: "#563d7c", Dart: "#00B4AB" };

let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

/* ================= state ================= */
const state = {
  tab: "hot", lang: "", topic: "", q: "",
  page: 1, total: 0, loading: false, done: false,
  seen: new Set(),
  likes: store.get("crb_likes", {}),      // full_name -> 1
  saves: store.get("crb_saves", {}),      // full_name -> snapshot
  comments: store.get("crb_comments", {}) // full_name -> [{t, ts}]
};
let current = null; // repo in modal
let DIGEST = { items: {} }; // AI 导读库（由 GitHub Actions 每日生成）
let FEED = null; // 静态预生成信息流（hot/new/classic），零 API 首屏
const aiOf = r => (DIGEST.items[r.full_name] && DIGEST.items[r.full_name].s) || "";

/* ================= query ================= */
function buildQuery() {
  const parts = [];
  if (state.q) parts.push(state.q);
  if (state.tab === "hot") parts.push("pushed:>" + daysAgo(14), state.q ? "stars:>10" : "stars:>500");
  if (state.tab === "new") parts.push("created:>" + daysAgo(30), "stars:>30");
  if (state.tab === "classic") parts.push("stars:>30000");
  if (state.lang) parts.push('language:"' + state.lang + '"');
  if (state.topic) parts.push("topic:" + state.topic);
  return parts.join(" ");
}

let reqSeq = 0; // 请求序号：新请求会作废还在路上的旧请求，避免竞态
async function fetchFeed(append) {
  // 只有“加载更多”需要被 loading/done 拦截；全新搜索/切换必须永远放行
  if (append && (state.loading || state.done)) return;
  const reqId = ++reqSeq;
  state.loading = true;
  const feed = $("#feed");
  if (!append) {
    feed.innerHTML = '<div class="skel"><div class="a"></div><div class="b"></div></div>'.repeat(6);
    state.page = 1; state.done = false; state.seen.clear();
  }
  const url = "https://api.github.com/search/repositories?q=" + encodeURIComponent(buildQuery()) +
    "&sort=stars&order=desc&per_page=30&page=" + state.page;
  try {
    const r = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
    if (reqId !== reqSeq) return; // 已被更新的请求取代，丢弃
    if (r.status === 403 || r.status === 429) throw { rate: true };
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    if (reqId !== reqSeq) return;
    state.total = Math.min(data.total_count, 1000);
    const items = (data.items || []).filter(it => !state.seen.has(it.full_name));
    items.forEach(it => state.seen.add(it.full_name));
    if (!append) feed.innerHTML = "";
    items.forEach(it => feed.appendChild(card(it)));
    state.page++;
    if (state.page * 30 > state.total + 30 || (data.items || []).length < 30) state.done = true;
    if (!feed.children.length) feed.innerHTML = '<div class="state"><div class="big">🧐</div>没找到项目，换个筛选或关键词试试</div>';
  } catch (e) {
    if (reqId !== reqSeq) return;
    const msg = e && e.rate
      ? "刷得太快啦～GitHub 接口限流中，休息一分钟再试"
      : "网络开小差了，稍后重试";
    if (!append) { feed.innerHTML = '<div class="state"><div class="big">🍵</div>' + msg + '<br><button id="retryBtn">点我重试</button></div>'; const rb = document.getElementById("retryBtn"); if (rb) rb.addEventListener("click", () => fetchFeed(false)); }
    else toast(msg);
  } finally {
    if (reqId === reqSeq) state.loading = false;
  }
}

/* ================= cards ================= */
function ogImg(fullName) { return "https://opengraph.githubassets.com/1/" + fullName; }
function fallbackCover(el, name) {
  const hues = [356, 20, 210, 260, 160, 300];
  const h = hues[name.length % hues.length];
  el.innerHTML = '<div class="fallback" style="background:linear-gradient(135deg,hsl(' + h + ',70%,62%),hsl(' + (h + 40) + ',70%,48%))">' + esc(name[0].toUpperCase()) + "</div>";
}

function card(repo) {
  const el = document.createElement("article");
  el.className = "card";
  el.dataset.repo = repo.full_name;
  const liked = !!state.likes[repo.full_name];
  const ai = aiOf(repo);
  const langDot = repo.language
    ? '<span class="tag lang"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (LANG_COLORS[repo.language] || "#999") + ';margin-right:4px"></span>' + esc(repo.language) + "</span>" : "";
  const topics = (repo.topics || []).slice(0, 2).map(t => '<span class="tag">#' + esc(t) + "</span>").join("");
  el.innerHTML =
    '<div class="cover"><img loading="lazy" alt=""></div>' +
    '<div class="c-body">' +
      '<div class="c-title">' + esc(repo.name) + "</div>" +
      (ai
        ? '<div class="c-ai"><span class="ai-tag">AI</span><span>' + esc(ai) + "</span></div>"
        : (repo.description ? '<div class="c-desc">' + esc(repo.description) + "</div>" : "")) +
      '<div class="c-tags">' + langDot + topics + "</div>" +
      '<div class="c-foot">' +
        '<img loading="lazy" src="' + esc(repo.owner.avatar_url) + '&s=40" alt="">' +
        '<span class="c-owner">' + esc(repo.owner.login) + "</span>" +
        '<span class="c-stat">⭐ ' + fmt(repo.stargazers_count) + "</span>" +
        '<button class="heart' + (liked ? " on" : "") + '">' + (liked ? HEART_F : HEART) + "</button>" +
      "</div>" +
    "</div>";
  const img = $(".cover img", el);
  img.src = ogImg(repo.full_name);
  img.onerror = () => fallbackCover($(".cover", el), repo.name);
  $(".heart", el).addEventListener("click", ev => {
    ev.stopPropagation();
    toggleLike(repo);
    const on = !!state.likes[repo.full_name];
    ev.currentTarget.className = "heart" + (on ? " on" : "");
    ev.currentTarget.innerHTML = on ? HEART_F : HEART;
  });
  el.addEventListener("click", () => openModal(repo));
  return el;
}

/* ================= like / save / comment ================= */
function toggleLike(repo) {
  if (state.likes[repo.full_name]) delete state.likes[repo.full_name];
  else { state.likes[repo.full_name] = 1; toast("点赞成功 ❤️"); }
  store.set("crb_likes", state.likes);
}
function snapshot(repo) {
  return { full_name: repo.full_name, name: repo.name, description: repo.description, language: repo.language, topics: (repo.topics || []).slice(0, 4), stargazers_count: repo.stargazers_count, forks_count: repo.forks_count, open_issues_count: repo.open_issues_count, html_url: repo.html_url, owner: { login: repo.owner.login, avatar_url: repo.owner.avatar_url }, pushed_at: repo.pushed_at, created_at: repo.created_at, homepage: repo.homepage, license: repo.license };
}
function toggleSave(repo) {
  if (state.saves[repo.full_name]) { delete state.saves[repo.full_name]; toast("已取消收藏"); }
  else { state.saves[repo.full_name] = snapshot(repo); toast("已收藏 🔖"); }
  store.set("crb_saves", state.saves);
}

/* ================= saved tab ================= */
function renderSaved() {
  const feed = $("#feed");
  feed.innerHTML = "";
  const list = Object.values(state.saves).reverse();
  if (!list.length) { feed.innerHTML = '<div class="state"><div class="big">🔖</div>还没有收藏～去「发现」页逛逛吧</div>'; return; }
  list.forEach(it => feed.appendChild(card(it)));
}

/* ================= modal ================= */
function openModal(repo) {
  current = repo;
  const liked = !!state.likes[repo.full_name];
  const saved = !!state.saves[repo.full_name];
  const ai = aiOf(repo);
  const lic = repo.license && repo.license.spdx_id && repo.license.spdx_id !== "NOASSERTION" ? repo.license.spdx_id : "—";
  $("#mScroll").innerHTML =
    '<div class="m-cover"><img alt=""></div>' +
    '<div class="m-body">' +
      '<div class="m-title">' + esc(repo.full_name) + "</div>" +
      '<div class="m-owner"><img src="' + esc(repo.owner.avatar_url) + '&s=60" alt=""><span class="n">' + esc(repo.owner.login) + '</span></div>' +
      (ai ? '<div class="c-ai m-ai"><span class="ai-tag">AI 导读</span><span>' + esc(ai) + "</span></div>" : "") +
      (repo.description ? '<div class="m-desc">' + esc(repo.description) + "</div>" : "") +
      '<div class="m-stats">' +
        "<span><b>" + fmt(repo.stargazers_count) + "</b>Star</span>" +
        "<span><b>" + fmt(repo.forks_count || 0) + "</b>Fork</span>" +
        "<span><b>" + fmt(repo.open_issues_count || 0) + "</b>Issues</span>" +
        "<span><b>" + esc(lic) + "</b>许可证</span>" +
        "<span><b>" + esc((repo.created_at || "").slice(0, 7) || "—") + "</b>创建于</span>" +
        "<span><b>" + esc((repo.pushed_at || "").slice(0, 10) || "—") + "</b>最近更新</span>" +
      "</div>" +
      (function () {
        let tg = "";
        if (repo.homepage) {
          const hp = safeUrl(repo.homepage);
          if (hp) tg += '<a class="tag" style="color:#4a6ee0" href="' + esc(hp) + '" target="_blank" rel="noopener noreferrer">🔗 项目官网</a>';
        }
        tg += (repo.topics || []).slice(0, 8).map(t => '<span class="tag">#' + esc(t) + "</span>").join("");
        return tg ? '<div class="m-tags">' + tg + "</div>" : "";
      })() +
      '<div class="m-sec">README 速览</div>' +
      '<div class="readme-wrap clip"><div class="md" id="readme">加载中…</div></div>' +
      '<button class="md-more" id="mdMore" style="display:none">展开全文 ⌄</button>' +
      '<div class="m-sec">评论</div>' +
      '<div class="cmt-hint">评论目前保存在你的浏览器本地（v2 将支持云端同步）</div>' +
      '<div id="cmts"></div>' +
    "</div>";
  const mImg = $(".m-cover img");
  mImg.src = ogImg(repo.full_name);
  mImg.onerror = () => fallbackCover($(".m-cover"), repo.name);

  $("#mActions").innerHTML =
    '<input class="cmt-input" id="cmtInput" placeholder="说点什么…" maxlength="200">' +
    '<button class="act' + (liked ? " on" : "") + '" id="aLike">' + (liked ? HEART_F : HEART) + "<span>点赞</span></button>" +
    '<button class="act' + (saved ? " on" : "") + '" id="aSave">' + (saved ? MARK_F : MARK) + "<span>收藏</span></button>" +
    '<button class="act" id="aShare">' + SHARE + "<span>分享</span></button>" +
    '<button class="act" id="aPoster">' + POSTER + "<span>海报</span></button>" +
    '<a class="gh-btn" href="' + esc(repo.html_url) + '" target="_blank" rel="noopener">去 GitHub ↗</a>';

  $("#aLike").addEventListener("click", () => { toggleLike(repo); openActionsRefresh(); refreshFeedHearts(repo); });
  $("#aSave").addEventListener("click", () => { toggleSave(repo); openActionsRefresh(); });
  $("#aPoster").addEventListener("click", () => showPoster(repo));
  $("#aShare").addEventListener("click", async () => {
    const text = repo.full_name + " · " + repo.html_url;
    try {
      if (navigator.share) { await navigator.share({ title: repo.full_name, url: repo.html_url }); return; }
      await navigator.clipboard.writeText(text);
      toast("链接已复制，去分享吧 🚀");
    } catch (e) {
      if (e && e.name === "AbortError") return;
      try {
        const ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); ta.remove();
        toast("链接已复制，去分享吧 🚀");
      } catch (e2) { toast("复制失败，请手动复制链接"); }
    }
  });
  $("#cmtInput").addEventListener("keydown", ev => { if (ev.key === "Enter") postComment(); });

  renderComments();
  loadReadme(repo);
  $("#overlay").classList.add("show");
  $("#modal").classList.add("show");
  document.body.style.overflow = "hidden";
}
function openActionsRefresh() {
  if (!current) return;
  const liked = !!state.likes[current.full_name], saved = !!state.saves[current.full_name];
  const aL = $("#aLike"), aS = $("#aSave");
  aL.className = "act" + (liked ? " on" : ""); aL.innerHTML = (liked ? HEART_F : HEART) + "<span>点赞</span>";
  aS.className = "act" + (saved ? " on" : ""); aS.innerHTML = (saved ? MARK_F : MARK) + "<span>收藏</span>";
}
function refreshFeedHearts(repo) {
  // 弹窗里点赞后，同步信息流卡片上的红心状态
  const on = !!state.likes[repo.full_name];
  $$('#feed .card[data-repo="' + CSS.escape(repo.full_name) + '"] .heart').forEach(h => {
    h.className = "heart" + (on ? " on" : "");
    h.innerHTML = on ? HEART_F : HEART;
  });
  if (state.tab === "saved") renderSaved();
}
function closeModal() {
  $("#overlay").classList.remove("show");
  $("#modal").classList.remove("show");
  document.body.style.overflow = "";
  current = null;
}
async function loadReadme(repo) {
  const box = $("#readme");
  const cacheKey = "crb_rm_" + repo.full_name;
  try {
    // 同一会话看过的 README 直接用缓存，省接口配额、秒开
    let html = null;
    try { html = sessionStorage.getItem(cacheKey); } catch (e) {}
    if (!html) {
      const r = await fetch("https://api.github.com/repos/" + repo.full_name + "/readme", { headers: { Accept: "application/vnd.github.html" } });
      if (!r.ok) throw 0;
      html = await r.text();
      if (!window.DOMPurify) { box.textContent = "README 渲染组件未加载，点击右下角「去 GitHub」查看"; return; }
      html = DOMPurify.sanitize(html, { FORBID_TAGS: ["style", "form", "input", "button"], ADD_ATTR: ["target"] });
      try { if (html.length < 300000) sessionStorage.setItem(cacheKey, html); } catch (e) {}
    }
    if (!current || current.full_name !== repo.full_name) return;
    box.innerHTML = html;
    $$("#readme a").forEach(a => { a.target = "_blank"; a.rel = "noopener"; });
    const more = $("#mdMore");
    if (box.scrollHeight > 560) {
      more.style.display = "block";
      more.onclick = () => { $(".readme-wrap").classList.remove("clip"); more.style.display = "none"; };
    } else $(".readme-wrap").classList.remove("clip");
  } catch (e) {
    box.textContent = "README 加载失败或不存在，点击右下角「去 GitHub」查看";
  }
}

/* ================= comments ================= */
function renderComments() {
  if (!current) return;
  const list = state.comments[current.full_name] || [];
  $("#cmts").innerHTML = list.length
    ? list.map(c => '<div class="cmt"><div class="av">我</div><div><div class="t">' + esc(c.t) + '</div><div class="ts">' + timeStr(c.ts) + "</div></div></div>").join("")
    : '<div class="cmt-hint" style="margin:4px 0 20px">还没有评论，坐个沙发？</div>';
}
function postComment() {
  const input = $("#cmtInput");
  const t = input.value.trim();
  if (!t || !current) return;
  const list = state.comments[current.full_name] || [];
  list.unshift({ t, ts: Date.now() });
  state.comments[current.full_name] = list.slice(0, 50);
  store.set("crb_comments", state.comments);
  input.value = "";
  renderComments();
  toast("评论成功 💬");
}

/* ================= 分享海报（纯 canvas，无外部依赖，CSP 安全） ================= */
function wrapText(ctx, text, maxWidth) {
  const lines = []; let line = "";
  for (const ch of String(text)) {
    if (ch === "\n") { lines.push(line); line = ""; continue; }
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = ch; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function makePoster(repo) {
  const W = 1080, H = 1440;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#ff2442"); g.addColorStop(1, "#c81030");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // 顶部品牌
  x.textBaseline = "alphabetic"; x.textAlign = "left";
  x.fillStyle = "#fff"; x.font = 'bold 46px -apple-system,"PingFang SC",sans-serif';
  x.fillText("📕 小码书", 70, 108);
  x.font = '28px -apple-system,"PingFang SC",sans-serif'; x.fillStyle = "rgba(255,255,255,.85)";
  x.textAlign = "right"; x.fillText("发现全世界的好项目", W - 70, 108); x.textAlign = "left";
  // 白卡
  const M = 70, cardY = 150, cardH = H - 300;
  x.fillStyle = "#fff"; roundRect(x, M, cardY, W - 2 * M, cardH, 48); x.fill();
  const px = M + 60, cw = W - 2 * M - 120; let y = cardY + 110;
  // owner / repo
  x.fillStyle = "#999"; x.font = '34px -apple-system,"PingFang SC",sans-serif';
  x.fillText(repo.owner.login + " /", px, y); y += 78;
  x.fillStyle = "#222"; x.font = 'bold 72px -apple-system,"PingFang SC",sans-serif';
  for (const ln of wrapText(x, repo.name, cw).slice(0, 2)) { x.fillText(ln, px, y); y += 84; }
  y += 30;
  // AI 导读优先，否则英文描述
  const ai = aiOf(repo);
  if (ai) {
    x.fillStyle = "#ff2442"; roundRect(x, px, y - 42, 78, 50, 12); x.fill();
    x.fillStyle = "#fff"; x.font = 'bold 30px -apple-system,sans-serif'; x.fillText("AI", px + 17, y - 6);
    y += 34;
    x.fillStyle = "#333"; x.font = '40px -apple-system,"PingFang SC",sans-serif';
    for (const ln of wrapText(x, ai, cw).slice(0, 7)) { x.fillText(ln, px, y); y += 58; }
  } else if (repo.description) {
    x.fillStyle = "#555"; x.font = '38px -apple-system,"PingFang SC",sans-serif';
    for (const ln of wrapText(x, repo.description, cw).slice(0, 5)) { x.fillText(ln, px, y); y += 54; }
  }
  // 底部统计
  const by = cardY + cardH - 180;
  x.fillStyle = "#ff2442"; x.font = 'bold 52px -apple-system,sans-serif';
  x.fillText("★ " + fmt(repo.stargazers_count), px, by);
  if (repo.language) { x.fillStyle = "#4a6ee0"; x.font = '38px -apple-system,sans-serif'; x.fillText("● " + repo.language, px + 300, by - 3); }
  x.strokeStyle = "#eee"; x.lineWidth = 2; x.beginPath(); x.moveTo(px, by + 48); x.lineTo(W - px, by + 48); x.stroke();
  x.fillStyle = "#999"; x.font = '32px -apple-system,"PingFang SC",sans-serif';
  x.fillText("像刷小红书一样逛 GitHub", px, by + 112);
  x.fillStyle = "#ff2442"; x.font = 'bold 32px -apple-system,sans-serif';
  x.fillText("warmwatercookfrogs.github.io/xiaomashu", px, by + 160);
  return c.toDataURL("image/png");
}
function showPoster(repo) {
  let url;
  try { url = makePoster(repo); } catch (e) { toast("海报生成失败，请重试"); return; }
  $("#posterImg").src = url;
  const dl = $("#posterDl");
  dl.href = url; dl.download = "小码书_" + repo.name + ".png";
  $("#posterOverlay").classList.add("show");
}

/* ============ 信息流来源决策：默认浏览走静态缓存（零 API），仅搜索走实时 API ============ */
function renderList(list) {
  reqSeq++; // 作废在途的 API 请求，避免其结果覆盖缓存渲染
  state.loading = false; state.done = true; // 缓存视图一次性渲染，关闭无限滚动
  const feed = $("#feed");
  feed.innerHTML = "";
  state.seen.clear();
  list.forEach(it => { state.seen.add(it.full_name); feed.appendChild(card(it)); });
  if (!feed.children.length) feed.innerHTML = '<div class="state"><div class="big">🧐</div>该筛选暂无缓存结果，试试搜索</div>';
}
// 有静态缓存且非搜索场景 → 本地渲染+客户端筛选；否则回退实时 API
function loadFeed() {
  if (state.tab === "saved") { renderSaved(); return; }
  if (!state.q && FEED && Array.isArray(FEED[state.tab])) {
    let list = FEED[state.tab];
    if (state.lang) list = list.filter(r => r.language === state.lang);
    if (state.topic) list = list.filter(r => (r.topics || []).includes(state.topic));
    if (list.length) { renderList(list); return; }
  }
  fetchFeed(false); // 搜索、或缓存未命中 → 实时 API
}

/* ================= events ================= */
$("#tabs").addEventListener("click", ev => {
  const b = ev.target.closest(".tab"); if (!b) return;
  $$("#tabs .tab").forEach(t => t.classList.toggle("on", t === b));
  state.tab = b.dataset.tab;
  window.scrollTo(0, 0);
  loadFeed();
});
function chipHandler(id, key) {
  $(id).addEventListener("click", ev => {
    const b = ev.target.closest(".chip"); if (!b) return;
    $$(id + " .chip").forEach(c => c.classList.toggle("on", c === b));
    state[key] = b.dataset.v;
    if (state.tab === "saved") { $$("#tabs .tab").forEach(t => t.classList.toggle("on", t.dataset.tab === "hot")); state.tab = "hot"; }
    loadFeed();
  });
}
chipHandler("#langChips", "lang");
chipHandler("#topicChips", "topic");

const qInput = $("#q");
function runSearch() {
  state.q = qInput.value.trim();
  if (state.tab === "saved") { $$("#tabs .tab").forEach(t => t.classList.toggle("on", t.dataset.tab === "hot")); state.tab = "hot"; }
  window.scrollTo(0, 0);
  loadFeed(); // 有搜索词走实时 API，清空搜索词回到缓存
}
qInput.addEventListener("keydown", ev => {
  if (ev.key === "Enter") { ev.preventDefault(); runSearch(); qInput.blur(); }
});
let qTimer;
qInput.addEventListener("input", () => {
  clearTimeout(qTimer);
  // 清空搜索框时自动回到默认信息流
  if (!qInput.value.trim() && state.q) qTimer = setTimeout(runSearch, 300);
});
qInput.addEventListener("search", () => { if (!qInput.value.trim() && state.q) runSearch(); });

$("#mClose").addEventListener("click", closeModal);
$("#overlay").addEventListener("click", closeModal);
function closePoster() { $("#posterOverlay").classList.remove("show"); }
$("#posterClose").addEventListener("click", closePoster);
$("#posterOverlay").addEventListener("click", ev => { if (ev.target.id === "posterOverlay") closePoster(); });
document.addEventListener("keydown", ev => { if (ev.key === "Escape") { closePoster(); closeModal(); } });

new IntersectionObserver(entries => {
  if (entries[0].isIntersecting && state.tab !== "saved" && !state.loading && !state.done) fetchFeed(true);
}, { rootMargin: "800px" }).observe($("#sentinel"));

/* ================= go ================= */
if (FEEDBACK_URL) {
  const f = $("#fbLink");
  f.href = FEEDBACK_URL; f.target = "_blank"; f.rel = "noopener"; f.style.display = "inline";
}
(async function boot() {
  $("#feed").innerHTML = '<div class="skel"><div class="a"></div><div class="b"></div></div>'.repeat(6); // 首屏骨架，避免空白闪烁
  // 并行加载 AI 导读库 + 静态信息流（均由 GitHub Actions 每日生成）
  const v = "?v=" + new Date().toISOString().slice(0, 10);
  const [dg, fd] = await Promise.allSettled([
    fetch("digest.json" + v).then(r => r.ok ? r.json() : null),
    fetch("feed.json" + v).then(r => r.ok ? r.json() : null)
  ]);
  if (dg.status === "fulfilled" && dg.value && dg.value.items) DIGEST = dg.value;
  if (!DIGEST.items) DIGEST.items = {};
  if (fd.status === "fulfilled" && fd.value && Array.isArray(fd.value.hot)) FEED = fd.value;
  loadFeed(); // 有缓存则零 API 首屏，否则自动回退实时 API
})();
