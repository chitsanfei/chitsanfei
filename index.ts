import axios from 'axios'
import dayjs from 'dayjs'
import { readFile, rm, writeFile } from 'fs/promises'
import { minify } from 'html-minifier'
import { shuffle } from 'lodash-es'
import MarkdownIt from 'markdown-it'
import * as rax from 'retry-axios'
import { github, motto, mxSpace, opensource, timeZone } from './config'
import { COMMNETS } from './constants'
import { GRepo } from './types'
import {
  AggregateController,
  createClient,
  NoteModel,
  PostModel,
} from '@mx-space/api-client'
import { axiosAdaptor } from '@mx-space/api-client/dist/adaptors/axios'

// 初始化 mxClient 客户端
// const mxClient = createClient(axiosAdaptor)(mxSpace.api, {
//   controllers: [AggregateController],
// })

// 设置 axios 的默认请求拦截器，添加 User-Agent
axiosAdaptor.default.interceptors.request.use((req) => {
  if (req.headers) req.headers['User-Agent'] = 'Innei profile'
  return req
})

// 初始化 MarkdownIt 解析器
const md = new MarkdownIt({ html: true })

// GitHub API 端点
const githubAPIEndPoint = 'https://api.github.com'

// 配置 rax 用于请求重试
rax.attach()
axios.defaults.raxConfig = {
  retry: 5,
  retryDelay: 4000,
  onRetryAttempt: (err) => {
    const cfg = rax.getConfig(err)
    console.log('request: \n', err.request)
    console.log(`Retry attempt #${cfg.currentRetryAttempt}`)
  },
}

// 设置 axios 默认 User-Agent
const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.61 Safari/537.36'

axios.defaults.headers.common['User-Agent'] = userAgent

// 创建 GitHub axios 实例
const gh = axios.create({
  baseURL: githubAPIEndPoint,
  timeout: 4000,
  headers: {
    'User-Agent': userAgent,
    ...(process.env.GITHUB_TOKEN && {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
    }),
  },
})

// 添加响应拦截器以处理错误
gh.interceptors.response.use(undefined, (err) => {
  console.log(err.message)
  return Promise.reject(err)
})

// 定义 GitHub 项目类型
type GHItem = {
  name: string
  id: number
  full_name: string
  description: string
  html_url: string
}

// 定义文章类型
type PostItem = {
  title: string
  summary: string
  created: string
  modified: string
  id: string
  slug: string
  category: {
    name: string
    slug: string
  }
}

/**
 * 生成开源项目的 HTML 表格
 */
function generateOpenSourceSectionHtml<T extends GHItem>(list: T[]) {
  const tbody = list
    .map(
      (cur) => `
      <tr>
        <td><a href="${cur.html_url}"><b>${cur.full_name}</b></a></td>
        <td><img alt="Stars" src="https://img.shields.io/github/stars/${cur.full_name}?style=flat-square&labelColor=343b41"/></td>
        <td><img alt="Forks" src="https://img.shields.io/github/forks/${cur.full_name}?style=flat-square&labelColor=343b41"/></td>
        <td><a href="https://github.com/${cur.full_name}/issues" target="_blank"><img alt="Issues" src="https://img.shields.io/github/issues/${cur.full_name}?style=flat-square&labelColor=343b41"/></a></td>
        <td><a href="https://github.com/${cur.full_name}/pulls" target="_blank"><img alt="Pull Requests" src="https://img.shields.io/github/issues-pr/${cur.full_name}?style=flat-square&labelColor=343b41"/></a></td>
        <td><a href="https://github.com/${cur.full_name}/commits" target="_blank"><img alt="Last Commits" src="https://img.shields.io/github/last-commit/${cur.full_name}?style=flat-square&labelColor=343b41"/></a></td>
      </tr>`
    )
    .join('')

  return m`
  <table>
    <thead align="center">
      <tr>
        <td><b>🎁 Projects</b></td>
        <td><b>⭐ Stars</b></td>
        <td><b>📚 Forks</b></td>
        <td><b>🛎 Issues</b></td>
        <td><b>📬 Pull requests</b></td>
        <td><b>💡 Last Commit</b></td>
      </tr>
    </thead>
    <tbody>
      ${tbody}
    </tbody>
  </table>`
}

/**
 * 生成玩具项目的 HTML 表格
 */
function generateToysHTML(list: GRepo[]) {
  const tbody = list
    .map(
      (cur) => `
      <tr>
        <td><a href="${cur.html_url}" target="_blank"><b>${cur.full_name}</b></a> 
        ${cur.homepage ? `<a href="${cur.homepage}" target="_blank">🔗</a>` : ''}</td>
        <td><img alt="Stars" src="https://img.shields.io/github/stars/${cur.full_name}?style=flat-square&labelColor=343b41"/></td>
        <td>${new Date(cur.created_at).toLocaleDateString()}</td>
        <td>${new Date(cur.pushed_at).toLocaleDateString()}</td>
      </tr>`
    )
    .join('')

  return m`
  <table>
    <thead align="center">
      <tr>
        <td><b>🎁 Projects</b></td>
        <td><b>⭐ Stars</b></td>
        <td><b>🕐 Created At</b></td>
        <td><b>📅 Last Active At</b></td>
      </tr>
    </thead>
    <tbody>
      ${tbody}
    </tbody>
  </table>`
}

/**
 * 生成单个 Repo 的 HTML 列表项
 */
function generateRepoHTML<T extends GHItem>(item: T) {
  return `<li><a href="${item.html_url}">${item.full_name}</a>${item.description ? `<p>${item.description}</p>` : ''}</li>`
}

/**
 * 生成文章列表的 HTML 列表项
 */
// function generatePostItemHTML<T extends Partial<PostModel>>(item: T) {
//   return m`
//   <li>
//     <span>${new Date(item.created).toLocaleDateString(undefined, {
//       dateStyle: 'short',
//       timeZone,
//     })} -  <a href="${mxSpace.url + '/posts/' + item.category.slug + '/' + item.slug}">${item.title}</a></span>
//     ${item.summary ? `<p>${item.summary}</p>` : ''}
//   </li>`
// }

/**
 * 生成笔记列表的 HTML 列表项
 */
// function generateNoteItemHTML<T extends Partial<NoteModel>>(item: T) {
//   return m`
//   <li>
//     <span>${new Date(item.created).toLocaleDateString(undefined, {
//       dateStyle: 'short',
//       timeZone,
//     })} -  <a href="${mxSpace.url + '/notes/' + item.nid}">${item.title}</a></span>
//   </li>`
// }

/**
 * 主函数，用于生成 README 和 index.html 文件
 */
async function main() {
  const template = await readFile('./readme.template.md', { encoding: 'utf-8' })
  let newContent = template

  // 获取活跃的开源项目详情
  const activeOpenSourceDetail: GRepo[] = await Promise.all(
    opensource.active.map((name) => gh.get('/repos/' + name).then((res) => res.data))
  )

  // 获取写过的玩具项目详情
  const toys = opensource.toys.random
    ? shuffle(opensource.toys.repos).slice(0, opensource.toys.limit)
    : opensource.toys.repos.slice(0, opensource.toys.limit)
  const toysProjectDetail: GRepo[] = await Promise.all(
    toys.map((name) => gh.get('/repos/' + name).then((res) => res.data))
  )

  // 替换模板中的占位符内容
  newContent = newContent
    .replace(gc('OPENSOURCE_DASHBOARD_ACTIVE'), generateOpenSourceSectionHtml(activeOpenSourceDetail))
    .replace(gc('OPENSOURCE_TOYS'), generateToysHTML(toysProjectDetail))

  // 获取 Star 项目并生成 HTML
  const star: any[] = await gh.get('/users/' + github.name + '/starred').then((res) => res.data)

  const topStar5 = star.slice(0, 5).map(generateRepoHTML).join('')
  newContent = newContent.replace(gc('RECENT_STAR'), m`<ul>${topStar5}</ul>`)

  const randomStars = shuffle(star.slice(5)).slice(0, 5).map(generateRepoHTML).join('')
  newContent = newContent.replace(gc('RANDOM_GITHUB_STARS'), m`<ul>${randomStars}</ul>`)

  // 获取最近的文章和笔记
  // {
  //   const posts = await mxClient.aggregate
  //     .getTimeline()
  //     .then((data) => data.data)
  //     .then((data) => {
  //       const posts = data.posts
  //       const notes = data.notes
  //       const sorted = [
  //         ...posts.map((i) => ({ ...i, type: 'Post' as const })),
  //         ...notes.map((i) => ({ ...i, type: 'Note' as const })),
  //       ].sort((b, a) => +new Date(a.created) - +new Date(b.created))
  //       return sorted.slice(0, 5).reduce((acc, cur) => {
  //         if (cur.type === 'Note') {
  //           return acc.concat(generateNoteItemHTML(cur))
  //         } else {
  //           return acc.concat(generatePostItemHTML(cur))
  //         }
  //       }, '')
  //     })

  //   newContent = newContent.replace(
  //     gc('RECENT_POSTS'),
  //     m`
  //     <ul>
  //     ${posts}
  //     </ul>
  //     `,
  //   )
  // }

  // 注入 Footer
  const now = new Date()
  const next = dayjs().add(24, 'h').toDate()

  newContent = newContent.replace(gc('FOOTER'), m`
    <p align="center">此文件 <i>README</i> <b>间隔 24 小时</b>自动刷新生成！
    <b>设计参考为 <a href="https://github.com/Innei/Innei">Innei</a> 的 Github Profile, Thanks.</b>
    </br>
    刷新于：${now.toLocaleString(undefined, { timeStyle: 'short', dateStyle: 'short', timeZone })}
    <br/>
    下一次刷新：${next.toLocaleString(undefined, { timeStyle: 'short', dateStyle: 'short', timeZone })}</p>
  `)

  newContent = newContent.replace(gc('MOTTO'), motto)

  // 写入最终的 README 和 index.html 文件
  await rm('./readme.md', { force: true })
  await writeFile('./readme.md', newContent, { encoding: 'utf-8' })

  const result = md.render(newContent)
  await writeFile('./index.html', result, { encoding: 'utf-8' })
}

/**
 * 获取占位符内容
 */
function gc(token: keyof typeof COMMNETS) {
  return `<!-- ${COMMNETS[token]} -->`
}

/**
 * 简单的 HTML 模板字符串函数，使用 HTML Minifier 进行压缩
 */
function m(html: TemplateStringsArray, ...args: any[]) {
  const str = html.reduce((s, h, i) => s + h + (args[i] ?? ''), '')
  return minify(str, {
    removeAttributeQuotes: true,
    removeEmptyAttributes: true,
    removeTagWhitespace: true,
    collapseWhitespace: true,
  }).trim()
}

main()
