// 小码书 · 每日生成脚本（在 GitHub Actions 中运行）
// 产出两个静态文件：
//   feed.json   —— hot/new/classic 三个信息流的完整元数据（前端零 API 首屏）
//   digest.json —— 各项目的 AI 中文导读（GitHub Models 生成，增量累积）
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) { console.log("缺少 GH_TOKEN，退出"); process.exit(1); }

const GH = { Accept: "application/vnd.github+json", Authorization: "Bearer " + TOKEN, "X-GitHub-Api-Version": "2022-11-28" };
const MAX_NEW = 40;   // 每次运行最多新生成 AI 导读条数（保护免费额度）
const KEEP = 400;     // digest.json 最多保留条数
const sleep = ms => new Promise(r => setTimeout(r, ms));
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

// 前端卡片所需的精简字段（去掉冗余，控制文件体积；topics 保留全量以便客户端筛选）
const slim = r => ({
  full_name: r.full_name, name: r.name, description: r.description,
  language: r.language, topics: r.topics || [],
  stargazers_count: r.stargazers_count, forks_count: r.forks_count, open_issues_count: r.open_issues_count,
  html_url: r.html_url, owner: { login: r.owner.login, avatar_url: r.owner.avatar_url },
  pushed_at: r.pushed_at, created_at: r.created_at, homepage: r.homepage, license: r.license
});

async function searchRepos(q, n) {
  const url = "https://api.github.com/search/repositories?q=" + encodeURIComponent(q) + "&sort=stars&order=desc&per_page=" + n;
  const r = await fetch(url, { headers: GH });
  if (!r.ok) { console.log("搜索失败", q, r.status); return []; }
  return (await r.json()).items || [];
}

async function readme(fullName) {
  try {
    const r = await fetch("https://api.github.com/repos/" + fullName + "/readme", { headers: { ...GH, Accept: "application/vnd.github.raw+json" } });
    if (!r.ok) return "";
    return (await r.text()).slice(0, 2500);
  } catch { return ""; }
}

async function summarize(repo, excerpt) {
  const r = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 150,
      messages: [
        { role: "system", content: "你是中文技术编辑。用一句30到60字的中文向非程序员介绍这个开源项目：它是什么、能帮用户做什么。口语化、说人话，不用营销腔和感叹号，不要重复项目名。直接输出这句话，不加引号和前缀。" },
        { role: "user", content: "项目：" + repo.full_name + "\n英文简介：" + (repo.description || "无") + "\nREADME 节选：\n" + (excerpt || "无") }
      ]
    })
  });
  if (!r.ok) throw new Error("models API " + r.status + " " + (await r.text()).slice(0, 200));
  const data = await r.json();
  return ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "").trim().replace(/^["'「『]+|["'」』]+$/g, "");
}

// ---------- 1) 抓取三个信息流 → feed.json ----------
const FEEDS = {
  hot: { q: "pushed:>" + daysAgo(14) + " stars:>500", n: 60 },
  new: { q: "created:>" + daysAgo(30) + " stars:>30", n: 45 },
  classic: { q: "stars:>30000", n: 45 }
};
const feed = { generated_at: new Date().toISOString(), hot: [], new: [], classic: [] };
const candidates = [];
const seen = new Set();
for (const key of Object.keys(FEEDS)) {
  const items = await searchRepos(FEEDS[key].q, FEEDS[key].n);
  feed[key] = items.map(slim);
  for (const it of items) if (!seen.has(it.full_name)) { seen.add(it.full_name); candidates.push(it); }
  await sleep(1500); // search API 限流保护
}
writeFileSync("feed.json", JSON.stringify(feed));
console.log("feed.json 写入：hot " + feed.hot.length + " / new " + feed.new.length + " / classic " + feed.classic.length);

// ---------- 2) 为候选项目生成 AI 导读 → digest.json（增量） ----------
let digest = { generated_at: "", items: {} };
if (existsSync("digest.json")) { try { digest = JSON.parse(readFileSync("digest.json", "utf8")); } catch {} }
if (!digest.items) digest.items = {};

let made = 0, failed = 0;
for (const repo of candidates) {
  if (made >= MAX_NEW) break;
  if (digest.items[repo.full_name]) continue; // 已有导读，跳过（节省额度）
  try {
    const ex = await readme(repo.full_name);
    const s = await summarize(repo, ex);
    if (s) { digest.items[repo.full_name] = { s, t: Date.now() }; made++; console.log("OK", repo.full_name, "->", s); }
    await sleep(4500); // 模型限流保护（免费额度约 15 次/分钟）
  } catch (e) {
    failed++;
    console.log("FAIL", repo.full_name, String(e).slice(0, 160));
    if (failed >= 5) { console.log("连续失败过多，提前结束（下次运行继续）"); break; }
    await sleep(8000);
  }
}

// 只保留最新 KEEP 条，防止文件无限膨胀
const entries = Object.entries(digest.items).sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, KEEP);
digest.items = Object.fromEntries(entries);
digest.generated_at = new Date().toISOString();
writeFileSync("digest.json", JSON.stringify(digest, null, 1));
console.log("digest.json 完成：新增 " + made + " 条，库中共 " + entries.length + " 条");
