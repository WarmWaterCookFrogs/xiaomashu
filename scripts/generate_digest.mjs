// 小码书 · AI 导读生成脚本（在 GitHub Actions 中每日运行）
// 数据流：GitHub 搜索热门项目 → 取 README 节选 → GitHub Models 生成中文导读 → 写入 digest.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) { console.log("缺少 GH_TOKEN，退出"); process.exit(1); }

const GH = { Accept: "application/vnd.github+json", Authorization: "Bearer " + TOKEN, "X-GitHub-Api-Version": "2022-11-28" };
const MAX_NEW = 40;   // 每次运行最多新生成条数（保护免费额度）
const KEEP = 400;     // digest.json 最多保留条数
const sleep = ms => new Promise(r => setTimeout(r, ms));
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

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

// ---------- 主流程 ----------
let digest = { generated_at: "", items: {} };
if (existsSync("digest.json")) { try { digest = JSON.parse(readFileSync("digest.json", "utf8")); } catch {} }
if (!digest.items) digest.items = {};

const seen = new Set();
const candidates = [];
for (const [q, n] of [["pushed:>" + daysAgo(14) + " stars:>500", 50], ["created:>" + daysAgo(30) + " stars:>30", 30]]) {
  for (const it of await searchRepos(q, n)) {
    if (!seen.has(it.full_name)) { seen.add(it.full_name); candidates.push(it); }
  }
}
console.log("候选项目:", candidates.length);

let made = 0, failed = 0;
for (const repo of candidates) {
  if (made >= MAX_NEW) break;
  if (digest.items[repo.full_name]) continue; // 已有导读，跳过
  try {
    const ex = await readme(repo.full_name);
    const s = await summarize(repo, ex);
    if (s) { digest.items[repo.full_name] = { s, t: Date.now() }; made++; console.log("OK", repo.full_name, "->", s); }
    await sleep(4500); // 限流保护（免费额度约 15 次/分钟）
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
console.log("完成：新增 " + made + " 条，库中共 " + entries.length + " 条");
