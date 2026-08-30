import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowShapeUtil,
  CubicBezier2d,
  Group2d,
  HTMLContainer,
  Rectangle2d,
  SVGContainer,
  ShapeUtil,
  T,
  Vec,
  createShapeId,
  getArrowBindings,
  getArrowTerminalsInArrowSpace,
  resizeBox,
  stopEventPropagation,
  toRichText,
  useValue,
  type Editor,
  type RecordProps,
  type TLArrowShape,
  type TLBaseShape,
  type TLResizeInfo
} from 'tldraw'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import * as XLSX from 'xlsx'
import hljs from 'highlight.js/lib/core'
import pythonLang from 'highlight.js/lib/languages/python'
hljs.registerLanguage('python', pythonLang)
import type { NotebookMsg } from '../flow-api'
import { loadPdf, renderPage, extractPageText, chunkText, textInBBox } from '../pdf/pdfjs'
import { embedPassages, loadEmbedder, embedQuery } from '../pdf/embeddings'
import MarkdownView from '../components/MarkdownView'
import ScaledSlide from '../slides/SlideHtml'
import { parseSlide } from '../slides/SlideView'
import { renderMermaidCode } from '../slides/mermaid'
import { NodeIcon } from '../os/nodeIcons'
import { parseAndMigrateExtra, markCorrupt, clearCorrupt, isExtraCorrupt, corruptRaw } from './schemas'
import { encode as gptEncode } from 'gpt-tokenizer'
import {
  DEFAULT_WORKFLOW_PROFILE,
  WorkflowProfileSchema,
  type WorkflowProfile
} from '../../../shared/orchestrator/workflowProfile'
import { buildOrchestratorStartArgs } from '../orchestrator/buildOrchestratorStartArgs'

// T3.1: приближённая оценка токенов (gpt-tokenizer, cl100k). В UI помечаем «≈».
export function estimateTokens(text: string): number {
  if (!text) return 0
  try {
    return gptEncode(text).length
  } catch {
    return Math.ceil(text.length / 4)
  }
}
import { SLIDE_SYSTEM_PROMPT, PALETTES, customPalette, type Palette } from '../slides/design'
import { slidesToPngs, exportPdf, exportPptx, type ExportItem } from '../slides/exporter'

// Лимит контекста: при достижении диалог начинается заново
const CONTEXT_LIMIT = 64000 // дефолт для локальных моделей

// Размер контекстного окна под конкретную модель (для API-провайдеров).
function contextLimitFor(model: string): number {
  const m = (model || '').toLowerCase()
  if (!m) return CONTEXT_LIMIT
  if (/gemini-1\.5|gemini-2|gemini.*pro|gemini.*flash/.test(m)) return 1000000
  if (/claude|sonnet|opus|haiku/.test(m)) return 200000
  if (/gpt-4o|gpt-4\.1|gpt-4-turbo|o1|o3|gpt-4\b/.test(m)) return 128000
  if (/glm-4|glm-4\.6/.test(m)) return 128000
  if (/deepseek/.test(m)) return 128000
  if (/gpt-3\.5/.test(m)) return 16000
  if (/llama-?3|qwen|mistral|mixtral|gemma|phi/.test(m)) return 32000
  return CONTEXT_LIMIT
}

type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string }

import { transcribe } from '../whisper'

// Вложения в ИИ-ноду
type Attachment = { id: string; kind: 'image' | 'file'; name: string; dataUrl?: string; text?: string }
const attId = () => Math.random().toString(36).slice(2, 9)
const TEXT_EXT =
  /\.(txt|md|markdown|json|csv|tsv|log|py|js|ts|tsx|jsx|html?|css|xml|ya?ml|ini|toml|sql|c|cpp|h|hpp|java|go|rs|rb|php|sh|bat|env)$/i
// Документы: текст извлекается в главном процессе (pdf-parse / OOXML)
const DOC_EXT = /\.(pdf|docx|pptx)$/i
// Изображения по расширению — на случай пустого MIME (heic/avif/webp с некоторых ОС)
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif|ico|tiff?)$/i

// --- Описание ноды ---
export type FlowNodeShape = TLBaseShape<
  'flow-node',
  {
    w: number
    h: number
    kind: string // note | ai | doc | answer
    title: string
    body: string // текст / промпт / ответ
    model: string // выбранная модель (ai)
    history: string // JSON-история диалога (ai)
    contextTokens: number // использовано токенов контекста (ai)
    answerId: string // id связанной карточки-ответа (ai)
    sourceId: string // id ноды-источника (у answer — его ai-нода)
    extra: string // JSON для будущих полей (чтобы не менять схему)
  }
>

// ---------- Палитра «Персональная ОС» ----------
// Через CSS-переменные — чтобы ноды подхватывали смену темы (Графит/Обсидиан/Тёплый уголь)
const C = {
  card: 'var(--panel)',
  cardTop: 'var(--panel2)',
  field: 'var(--bg)',
  border: 'var(--border)',
  text: 'var(--text)',
  textDim: 'var(--muted)',
  blue: 'var(--accent)',
  green: 'var(--c-note)',
  amber: 'var(--c-code)',
  red: '#F87171'
}

const KINDS: Record<string, { color: string; grad: string; icon: string }> = {
  note: { color: '#4ADE80', grad: 'linear-gradient(160deg,#6ee7a0,#4ADE80)', icon: '📝' },
  ai: { color: '#22D3EE', grad: 'linear-gradient(160deg,#5ce1f5,#22D3EE)', icon: '🤖' },
  doc: { color: '#4ADE80', grad: 'linear-gradient(160deg,#6ee7a0,#4ADE80)', icon: '📄' },
  answer: { color: '#A78BFA', grad: 'linear-gradient(160deg,#c4b1ff,#A78BFA)', icon: '✨' },
  code: { color: '#FBBF24', grad: 'linear-gradient(160deg,#fcd15a,#FBBF24)', icon: '💻' },
  codeblock: { color: '#FBBF24', grad: 'linear-gradient(160deg,#fcd15a,#FBBF24)', icon: '📦' },
  search: { color: '#22D3EE', grad: 'linear-gradient(160deg,#5ce1f5,#22D3EE)', icon: '🔎' },
  image: { color: '#A78BFA', grad: 'linear-gradient(160deg,#c4b1ff,#A78BFA)', icon: '🖼' },
  deck: { color: '#F472B6', grad: 'linear-gradient(160deg,#f89bcd,#F472B6)', icon: '🎞' },
  slide: { color: '#8B93A3', grad: 'linear-gradient(160deg,#a7aebb,#8B93A3)', icon: '▭' },
  ref: { color: '#22D3EE', grad: 'linear-gradient(160deg,#5ce1f5,#22D3EE)', icon: '📎' },
  diagram: { color: '#22D3EE', grad: 'linear-gradient(160deg,#5ce1f5,#22D3EE)', icon: '◇' },
  opencode: { color: '#F97316', grad: 'linear-gradient(160deg,#fb923c,#F97316)', icon: '🖥' },
  anythingllm: { color: '#14B8A6', grad: 'linear-gradient(160deg,#2dd4bf,#14B8A6)', icon: '🧠' },
  openscience: { color: '#2C7BE5', grad: 'linear-gradient(160deg,#5b9cf0,#2C7BE5)', icon: '🔬' },
  webgpt: { color: '#10A37F', grad: 'linear-gradient(160deg,#1fbe97,#10A37F)', icon: '💬' },
  webgemini: { color: '#4285F4', grad: 'linear-gradient(160deg,#6fa8ff,#4285F4)', icon: '✦' },
  webglm: { color: '#3B6FF6', grad: 'linear-gradient(160deg,#6d94ff,#3B6FF6)', icon: '🌐' },
  daylane: { color: '#64748B', grad: 'linear-gradient(160deg,#94a3b8,#64748B)', icon: '📆' },
  tlaxis: { color: '#475569', grad: 'linear-gradient(160deg,#64748b,#475569)', icon: '🗓' },
  boardmem: { color: '#F59E0B', grad: 'linear-gradient(160deg,#fbbf5a,#F59E0B)', icon: '🧠' },
  notebook: { color: '#F9A825', grad: 'linear-gradient(160deg,#ffca28,#F9A825)', icon: '📓' },
  pdf: { color: '#FF6B6B', grad: 'linear-gradient(160deg,#ff8a8a,#FF6B6B)', icon: '📕' },
  orchestrator: { color: '#A78BFA', grad: 'linear-gradient(160deg,#c4b1ff,#A78BFA)', icon: '🕸' },
  orchtask: { color: '#A78BFA', grad: 'linear-gradient(160deg,#c4b1ff,#A78BFA)', icon: '◈' },
  orchcall: { color: '#38BDF8', grad: 'linear-gradient(160deg,#7dd3fc,#38BDF8)', icon: '▹' },
  list: { color: '#F59E0B', grad: 'linear-gradient(160deg,#fbbf5a,#F59E0B)', icon: '🗂' },
  listcard: { color: '#F59E0B', grad: 'linear-gradient(160deg,#fbbf5a,#F59E0B)', icon: '🗂' },
  kanban: { color: '#38BDF8', grad: 'linear-gradient(160deg,#7dd3fc,#38BDF8)', icon: '📋' },
  board: { color: '#818CF8', grad: 'linear-gradient(160deg,#a5b4fc,#818CF8)', icon: '🗂' },
  sheet: { color: '#34D399', grad: 'linear-gradient(160deg,#6ee7b7,#34D399)', icon: '▦' }
}

// Короткое имя типа ноды для анимированной плашки-бейджа в шапке.
const KIND_NAME: Record<string, string> = {
  note: 'Заметка',
  ai: 'ИИ-чат',
  doc: 'Документ',
  answer: 'Ответ',
  code: 'Код',
  codeblock: 'Код',
  search: 'Поиск',
  image: 'Картинка',
  deck: 'Слайды',
  slide: 'Слайд',
  ref: 'Референс',
  diagram: 'Схема',
  opencode: 'OpenCode',
  anythingllm: 'AnythingLLM',
  openscience: 'OpenScience',
  webgpt: 'ChatGPT',
  webgemini: 'Gemini',
  webglm: 'GLM',
  daylane: 'День',
  tlaxis: 'Ось',
  boardmem: 'Память доски',
  notebook: 'Ноутбук',
  pdf: 'PDF',
  orchestrator: 'Оркестратор',
  orchtask: 'Задача',
  orchcall: 'Вызов',
  list: 'Список',
  listcard: 'Список',
  kanban: 'Канбан',
  board: 'Бэклог',
  sheet: 'Таблица'
}

// Собрать референсы, присоединённые к ноде стрелками (картинки + текст)
function gatherReferences(editor: Editor, deckId: string): { images: string[]; texts: string[] } {
  const images: string[] = []
  const texts: string[] = []
  const seen = new Set<string>()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toDeck = (editor as any).getBindingsToShape(deckId, 'arrow') as Array<{ fromId: string }>
    for (const b of toDeck) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arrowBs = (editor as any).getBindingsFromShape(b.fromId, 'arrow') as Array<{ toId: string }>
      for (const ab of arrowBs) {
        if (ab.toId === deckId || seen.has(ab.toId)) continue
        seen.add(ab.toId)
        const ref = editor.getShape<FlowNodeShape>(ab.toId as never)
        if (!ref || ref.type !== 'flow-node') continue
        const p = ref.props
        try {
          const img = JSON.parse(p.extra || '{}').image
          if (img) images.push(img)
        } catch {
          /* ignore */
        }
        const t = `${p.title ? p.title + ': ' : ''}${p.body || ''}`.trim()
        if (t && p.kind !== 'ref' && p.kind !== 'slide') texts.push(t)
      }
    }
  } catch {
    /* API отличается — не критично */
  }
  return { images, texts }
}

// Живые снимки диалогов агент-нод (opencode/anythingllm/openscience). Их содержимое
// живёт в терминале/webview, а не в props шейпа, поэтому каждая такая нода, пока
// открыта, кладёт сюда свой транскрипт (in-memory, без записи в props — чтобы не
// раздувать undo/сохранение). Сбор контекста по стрелке читает отсюда.
const agentTranscripts = new Map<string, string>()
function setAgentTranscript(id: string, text: string): void {
  const t = (text || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (t.length > 20) agentTranscripts.set(id, t.slice(-12000))
}
// Убрать ANSI/управляющие последовательности из вывода терминала (без литералов
// управляющих символов в исходнике: ESC через fromCharCode, прочие — по коду).
function stripAnsi(s: string): string {
  const ESC = String.fromCharCode(27)
  const csi = new RegExp(ESC + '\\[[0-9;?]*[ -/]*[@-~]', 'g')
  const other = new RegExp(ESC + '[()#=>][0-9A-Za-z]?', 'g')
  const cleaned = s.replace(csi, '').replace(other, '')
  let out = ''
  for (const ch of cleaned) {
    const c = ch.charCodeAt(0)
    if (c === 9 || c === 10 || c >= 32) out += ch
  }
  return out
}

// ============================================================================
// Веб-чат-ноды (ChatGPT / Gemini / GLM). Встраиваем публичный сайт в <webview> с
// ОТДЕЛЬНОЙ persist-сессией на провайдера → пользователь логинится своим аккаунтом,
// логин сохраняется между запусками. Нода умеет: (1) снимать транскрипт диалога в
// agentTranscripts (чтобы API-ноды видели его по стрелке), (2) программно вписать
// запрос в поле ввода веб-чата и дождаться ответа — этим пользуется и кнопка, и мост
// оркестратора. Селекторы сайтов хрупкие: при поломке верстки их правят тут.
// ============================================================================
type WebLLMKind = 'webgpt' | 'webgemini' | 'webglm'
type WebLLMConf = {
  name: string
  url: string
  partition: string
  bg: string
  // JS в контексте страницы: вписать текст в поле ввода и отправить. Возвращает true при успехе.
  inject: (text: string) => string
  // JS: вернуть innerText ПОСЛЕДНЕГО ответа ассистента ('' если нет).
  lastReply: string
}
// Экранируем текст в JS-строковый литерал (внутри одинарных кавычек).
function jsStr(s: string): string {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '') + "'"
}
// Универсальная отправка: найти поле (по списку селекторов), вписать текст через
// execCommand('insertText') (работает и в ProseMirror/Quill), затем нажать «отправить»
// (кнопка по селектору ИЛИ Enter). Возвращает true, если поле нашлось.
function buildInject(inputSels: string[], sendSels: string[]): (text: string) => string {
  const inSel = JSON.stringify(inputSels)
  const sendSel = JSON.stringify(sendSels)
  return (text: string) => `(function(){
    try {
      var TXT = ${jsStr(text)};
      var el = null, sels = ${inSel};
      for (var i=0;i<sels.length;i++){ el = document.querySelector(sels[i]); if(el) break; }
      if(!el){ el = document.querySelector('textarea:not([disabled])') || document.querySelector('[contenteditable="true"]'); }
      if(!el) return false;
      el.focus();
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value') || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');
        if (setter && setter.set) setter.set.call(el, TXT); else el.value = TXT;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        try { document.execCommand('selectAll', false, null); document.execCommand('insertText', false, TXT); }
        catch(e){ el.textContent = TXT; }
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: TXT }));
      }
      var send = function(){
        var bs = ${sendSel};
        for (var j=0;j<bs.length;j++){ var b = document.querySelector(bs[j]); if(b && !b.disabled){ b.click(); return true; } }
        var ev = { bubbles:true, cancelable:true, key:'Enter', code:'Enter', keyCode:13, which:13 };
        el.dispatchEvent(new KeyboardEvent('keydown', ev));
        el.dispatchEvent(new KeyboardEvent('keyup', ev));
        return true;
      };
      setTimeout(send, 220);
      return true;
    } catch(e){ return false; }
  })()`
}
// JS для чтения последнего ответа ассистента по набору селекторов (fallback — весь текст).
function buildLastReply(sels: string[]): string {
  return `(function(){
    try {
      var sels = ${JSON.stringify(sels)};
      for (var i=0;i<sels.length;i++){
        var els = document.querySelectorAll(sels[i]);
        if (els.length){ var t = els[els.length-1].innerText || ''; if(t.trim()) return t.trim(); }
      }
      return '';
    } catch(e){ return ''; }
  })()`
}
const WEBLLM: Record<WebLLMKind, WebLLMConf> = {
  webgpt: {
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    partition: 'persist:webllm-chatgpt',
    bg: '#212121',
    inject: buildInject(['#prompt-textarea', 'textarea[data-testid="prompt-textarea"]'], ['[data-testid="send-button"]', 'button[aria-label*="Send"]', 'button[aria-label*="Отправить"]']),
    lastReply: buildLastReply(['[data-message-author-role="assistant"] .markdown', '[data-message-author-role="assistant"]'])
  },
  webgemini: {
    name: 'Gemini',
    url: 'https://gemini.google.com/app',
    partition: 'persist:webllm-gemini',
    bg: '#1b1c1d',
    inject: buildInject(['.ql-editor[contenteditable="true"]', 'rich-textarea .ql-editor', 'div[contenteditable="true"]'], ['button.send-button', 'button[aria-label*="Send"]', 'button[aria-label*="Отправить"]']),
    lastReply: buildLastReply(['message-content .markdown', '.model-response-text', 'message-content'])
  },
  webglm: {
    name: 'GLM',
    url: 'https://chat.z.ai/',
    partition: 'persist:webllm-glm',
    bg: '#0f1117',
    inject: buildInject(['#chat-input', 'textarea#chat-input', 'textarea[placeholder]'], ['#send-message-button', 'button[type="submit"]', 'button[aria-label*="Send"]']),
    lastReply: buildLastReply(['.chat-assistant', '[data-message-role="assistant"]', '.message-content'])
  }
}
const webLLMConf = (kind: string): WebLLMConf => WEBLLM[(kind as WebLLMKind)] || WEBLLM.webgpt

// Реестр «драйверов» смонтированных веб-чат-нод: shapeId → функция «спросить и дождаться
// ответа». Наполняется в WebLLMBody, читается App.tsx (мост оркестратора). Как и
// agentTranscripts — in-memory, живёт пока нода открыта.
export type WebLLMDriver = {
  provider: string
  ask: (prompt: string, timeoutMs?: number) => Promise<string>
  lastReply: () => Promise<string>
}
export const webLLMRegistry = new Map<string, WebLLMDriver>()

// ============================================================================
// Память доски (таймлайн-режим): накопительные дневные выжимки контекста. СВОЯ у
// каждой доски — ключ по boardId (у другой доски своя память). Живёт в localStorage
// renderer (не в props шейпа — чтобы не раздувать undo/сохранение/синхронизацию).
// RAG-БД файлов (AnythingLLM) — отдельная система и может пересекаться между досками.
// ============================================================================
export type MemScope = 'day' | 'week' | 'month'
export type BoardMemEntry = { date: string; text: string; ts: number; scope?: MemScope }
const bid = (boardId: string): string => boardId || 'default'
// Синхронный кэш памяти доски в renderer. Источник истины — локальная БД в main (T1.1),
// но boardMemText/readBoardMem вызываются СИНХРОННО (в extractNodeContext — сбор контекста
// по стрелкам), поэтому держим зеркало здесь: гидратируем при загрузке/смене доски,
// пишем — сразу в кэш + асинхронно в БД.
const memCache = new Map<string, BoardMemEntry[]>()
const memHydrated = new Set<string>()

// Загрузить память доски из БД в кэш. Вызывать при открытии/смене доски.
export async function hydrateBoardMem(boardId: string): Promise<void> {
  const id = bid(boardId)
  try {
    const res = await window.flow.memory.list({ boardId: id })
    if (res.ok) {
      memCache.set(
        id,
        res.data
          .map((e) => ({ date: e.periodKey, text: e.content, ts: e.updatedAt, scope: e.periodKind as MemScope }))
          .sort((a, b) => a.date.localeCompare(b.date))
      )
      memHydrated.add(id)
      try {
        window.dispatchEvent(new CustomEvent('flow-boardmem-updated', { detail: id }))
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* мягкая деградация: память пустая, приложение работает */
  }
}
export function isBoardMemHydrated(boardId: string): boolean {
  return memHydrated.has(bid(boardId))
}
export function readBoardMem(boardId: string): BoardMemEntry[] {
  return memCache.get(bid(boardId)) || []
}
// Добавить/заменить выжимку за (дата, scope) — один период = одна запись. Кэш обновляется
// синхронно, запись в БД — асинхронно (fire-and-forget с логом ошибки).
function appendBoardMem(boardId: string, entry: BoardMemEntry): void {
  const id = bid(boardId)
  const scope: MemScope = entry.scope || 'day'
  const norm: BoardMemEntry = { ...entry, scope }
  const list = (memCache.get(id) || []).slice()
  const idx = list.findIndex((e) => e.date === norm.date && (e.scope || 'day') === scope)
  if (idx >= 0) list[idx] = norm
  else list.push(norm)
  list.sort((a, b) => a.date.localeCompare(b.date))
  memCache.set(id, list)
  try {
    window.dispatchEvent(new CustomEvent('flow-boardmem-updated', { detail: id }))
  } catch {
    /* ignore */
  }
  window.flow.memory
    .upsert({ boardId: id, periodKind: scope, periodKey: norm.date, content: norm.text, ts: norm.ts })
    .then((r) => {
      if (!r.ok) console.error('[memory] upsert failed:', r.error)
    })
    .catch((e) => console.error('[memory] upsert error:', e))
  // T2.4: текст выжимки изменился — эмбеддинг устарел, инвалидируем и пересчитаем в фоне.
  memEmbCache.get(id)?.delete(embKey(scope, norm.date))
  void backgroundIndexMem(id)
}
// Вся память доски одним текстом (для контекста связанным нодам и следующим дням).
export function boardMemText(boardId: string): string {
  return readBoardMem(boardId)
    .map((e) => `[${e.date}] ${e.text}`)
    .join('\n\n')
}

// T4.1: поиск по транскриптам веб-чат/агент-нод (agentTranscripts живёт в renderer, только
// для смонтированных в этой сессии нод). Возвращает id shape + сниппет вокруг совпадения.
export function searchTranscripts(query: string, limit = 30): { shapeId: string; snippet: string }[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: { shapeId: string; snippet: string }[] = []
  for (const [id, text] of agentTranscripts) {
    const idx = text.toLowerCase().indexOf(q)
    if (idx < 0) continue
    const start = Math.max(0, idx - 40)
    const snippet =
      (start > 0 ? '…' : '') + text.slice(start, idx + q.length + 80).replace(/\s+/g, ' ').trim() + '…'
    out.push({ shapeId: id, snippet })
    if (out.length >= limit) break
  }
  return out
}

// ── T2.4: память доски через retrieval (вместо «вся память в контекст») ──────────
function cosineSim(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8)
}
// boardId → ("kind|periodKey" → vector). Зеркало memory_embeddings в renderer.
const memEmbCache = new Map<string, Map<string, number[]>>()
const embKey = (kind: string, key: string): string => `${kind || 'day'}|${key}`

let memCfg = { retrieval: true, budget: 4000, recentDays: 7, topK: 6 }
export async function refreshMemCfg(): Promise<void> {
  try {
    const s = await window.flow.getSettings()
    memCfg = {
      retrieval: s.memoryRetrieval !== false,
      budget: s.memoryContextBudget || 4000,
      recentDays: s.memoryRecentDays || 7,
      topK: s.memoryTopK || 6
    }
  } catch {
    /* defaults */
  }
}

// Загрузить эмбеддинги выжимок доски из БД + фоново досчитать недостающие.
export async function hydrateMemEmbeddings(boardId: string): Promise<void> {
  const id = boardId || 'default'
  try {
    const res = await window.flow.memory.embList({ boardId: id })
    if (res.ok) {
      const m = new Map<string, number[]>()
      for (const e of res.data) m.set(embKey(e.periodKind, e.periodKey), e.vector)
      memEmbCache.set(id, m)
    }
  } catch {
    /* ignore */
  }
  void backgroundIndexMem(id)
}

// Фоновая доиндексация: эмбеддим выжимки без вектора (порциями, чтобы не грузить всё сразу).
async function backgroundIndexMem(boardId: string): Promise<void> {
  const id = boardId || 'default'
  const entries = readBoardMem(id)
  if (!entries.length) return
  const cache = memEmbCache.get(id) || new Map<string, number[]>()
  memEmbCache.set(id, cache)
  const todo = entries.filter((e) => !cache.has(embKey(e.scope || 'day', e.date))).slice(0, 30)
  if (!todo.length) return
  try {
    const vecs = await embedPassages(todo.map((e) => e.text.slice(0, 2000)))
    for (let i = 0; i < todo.length; i++) {
      const e = todo[i]
      const kind = (e.scope || 'day') as MemScope
      cache.set(embKey(kind, e.date), vecs[i])
      window.flow.memory.embSet({ boardId: id, periodKind: kind, periodKey: e.date, vector: vecs[i] }).catch(() => {})
    }
    try {
      window.dispatchEvent(new CustomEvent('flow-boardmem-updated', { detail: id }))
    } catch {
      /* ignore */
    }
  } catch {
    /* модель эмбеддингов недоступна — retrieval мягко деградирует до recent+сводок */
  }
}

// Собрать контекст памяти: последние N дней + top-k релевантных старых (по queryVector) +
// недельные/месячные сводки, в пределах токен-бюджета. queryVector=null → без релевантности
// (только последние + сводки). Флаг retrieval выключен → вся память (прежнее поведение).
export function buildMemoryContext(boardId: string, queryVector: number[] | null): string {
  const id = boardId || 'default'
  const entries = readBoardMem(id)
  if (!entries.length) return ''
  if (!memCfg.retrieval) return boardMemText(id)
  const fmt = (e: BoardMemEntry): string => `[${e.date}] ${e.text}`
  const days = entries.filter((e) => (e.scope || 'day') === 'day').sort((a, b) => a.date.localeCompare(b.date))
  const monthly = entries.filter((e) => e.scope === 'month')
  const weekly = entries.filter((e) => e.scope === 'week')
  const recent = days.slice(-memCfg.recentDays)
  const recentKeys = new Set(recent.map((e) => e.date))
  const older = days.filter((e) => !recentKeys.has(e.date))
  // Релевантные старые дни по косинусу к запросу (если есть вектор и эмбеддинги).
  let relevantOlder: BoardMemEntry[] = []
  const cache = memEmbCache.get(id)
  if (queryVector && cache) {
    relevantOlder = older
      .map((e) => ({ e, s: cache.has(embKey('day', e.date)) ? cosineSim(queryVector, cache.get(embKey('day', e.date))!) : -1 }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, memCfg.topK)
      .map((x) => x.e)
  }
  // Отбор в пределах бюджета: сначала компактные сводки, затем свежие дни, затем релевантные старые.
  const budget = memCfg.budget
  let used = 0
  const picked = new Set<BoardMemEntry>()
  const tryAdd = (e: BoardMemEntry): void => {
    if (picked.has(e)) return
    const t = estimateTokens(fmt(e))
    if (used + t <= budget) {
      picked.add(e)
      used += t
    }
  }
  monthly.forEach(tryAdd)
  weekly.forEach(tryAdd)
  ;[...recent].reverse().forEach(tryAdd)
  relevantOlder.forEach(tryAdd)
  const byDate = (a: BoardMemEntry, b: BoardMemEntry): number => a.date.localeCompare(b.date)
  const out = [
    ...monthly.filter((e) => picked.has(e)),
    ...weekly.filter((e) => picked.has(e)),
    ...relevantOlder.filter((e) => picked.has(e)).sort(byDate),
    ...recent.filter((e) => picked.has(e))
  ]
  return out.map(fmt).join('\n\n')
}

// Выжимка «дня» таймлайна: собрать контент нод, чьи ЦЕНТРЫ по вертикали попадают в
// полосу дня [yTop, yBottom), суммаризовать (с учётом прошлой памяти — только новое) и
// добавить в память доски. Так «конец дня» накопительно передаётся в следующий день.
export async function digestDayRange(
  editor: Editor,
  boardId: string,
  yTop: number,
  yBottom: number,
  dateIso: string
): Promise<{ ok: boolean; error?: string; empty?: boolean }> {
  const parts: string[] = []
  for (const s of editor.getCurrentPageShapes()) {
    if (s.type !== 'flow-node') continue
    const fs = s as FlowNodeShape
    if (fs.props.kind === 'boardmem' || fs.props.kind === 'daylane' || fs.props.kind === 'tlaxis') continue
    const b = editor.getShapePageBounds(s.id)
    if (!b) continue
    const cy = b.y + b.h / 2
    if (cy >= yTop && cy < yBottom) {
      const ctx = extractNodeContext(editor, fs)
      if (ctx) parts.push(ctx)
    }
  }
  const content = parts.join('\n\n').slice(0, 12000)
  if (!content) return { ok: false, empty: true }
  const prior = boardMemText(boardId).slice(-6000)
  const res = await window.flow.aiChat({
    model: '',
    messages: [
      {
        role: 'system',
        content:
          'Ты ведёшь ГЛОБАЛЬНУЮ ПАМЯТЬ проекта на доске. По содержимому за день сделай сжатую выжимку (5–10 пунктов): ' +
          'что сделано, ключевые решения/факты/файлы, что важно помнить дальше. По-русски, по пунктам. ' +
          'Учитывай прошлую память для связности, но НЕ повторяй её — фиксируй только НОВОЕ за этот день.'
      },
      { role: 'user', content: `ПРОШЛАЯ ПАМЯТЬ ПРОЕКТА:\n${prior || '(пусто)'}\n\nСОДЕРЖИМОЕ ДНЯ ${dateIso}:\n${content}` }
    ],
    timeoutMs: 90000
  })
  if (!res.ok) return { ok: false, error: res.error }
  appendBoardMem(boardId, { date: dateIso, text: res.content.trim(), ts: Date.now(), scope: 'day' })
  return { ok: true }
}

// Сводка периода (неделя/месяц): суммаризует ДНЕВНЫЕ выжимки этих дат в итог более
// высокого уровня и кладёт отдельной записью памяти (с scope). Для авто-выгрузки
// «после каждой недели/месяца».
export async function rollupMemory(
  boardId: string,
  scope: 'week' | 'month',
  dateKey: string,
  label: string,
  isoDates: string[]
): Promise<{ ok: boolean; empty?: boolean; error?: string }> {
  const daily = readBoardMem(boardId).filter((e) => (!e.scope || e.scope === 'day') && isoDates.includes(e.date))
  if (!daily.length) return { ok: false, empty: true }
  const body = daily.map((e) => `[${e.date}] ${e.text}`).join('\n\n')
  const res = await window.flow.aiChat({
    model: '',
    messages: [
      {
        role: 'system',
        content:
          `Ты сводишь память проекта за ${label}. По дневным выжимкам сделай КРАТКИЙ ИТОГ ПЕРИОДА (5–8 пунктов): ` +
          'главное и достигнутое, ключевые решения, что важно помнить дальше. По-русски, по пунктам.'
      },
      { role: 'user', content: body }
    ],
    timeoutMs: 90000
  })
  if (!res.ok) return { ok: false, error: res.error }
  appendBoardMem(boardId, { date: dateKey, text: res.content.trim(), ts: Date.now(), scope })
  return { ok: true }
}

// Текст-контекст из ноды-источника (для передачи в связанный чат по стрелке).
function extractNodeContext(editor: Editor, s: FlowNodeShape): string {
  const p = s.props
  const title = (p.title || '').trim()
  // Агент-ноды с живым диалогом в терминале/webview — берём их снимок из реестра.
  if (
    p.kind === 'opencode' ||
    p.kind === 'anythingllm' ||
    p.kind === 'openscience' ||
    p.kind === 'webgpt' ||
    p.kind === 'webgemini' ||
    p.kind === 'webglm'
  ) {
    const t = (agentTranscripts.get(String(s.id)) || '').trim()
    if (!t) return ''
    const label =
      p.kind === 'opencode'
        ? 'OpenCode (терминал)'
        : p.kind === 'anythingllm'
        ? 'AnythingLLM'
        : p.kind === 'openscience'
        ? 'OpenScience'
        : `Веб-чат ${webLLMConf(p.kind).name}`
    return `${label}${title ? ` «${title}»` : ''}:\n${t.slice(-8000)}`
  }
  if (p.kind === 'boardmem') {
    // Глобальная память доски (накопленные дневные выжимки) — для связанных ИИ/оркестратора.
    let ex: { boardId?: string } = {}
    try {
      ex = JSON.parse(p.extra || '{}')
    } catch {
      /* ignore */
    }
    const t = boardMemText(ex.boardId || '')
    return t ? `Глобальная память доски (по дням):\n${t.slice(-8000)}` : ''
  }
  if (p.kind === 'ai') {
    // Последние реплики диалога — чтобы следующий чат «видел» ход обсуждения
    try {
      const hist = JSON.parse(p.history || '[]') as ChatMessage[]
      const parts = hist
        .filter((m) => m.role !== 'system')
        .slice(-4)
        .map((m) => `${m.role === 'user' ? 'Вопрос' : 'Ответ'}: ${m.content}`)
      if (parts.length) return `Чат «${title || 'AI'}»:\n${parts.join('\n')}`
    } catch {
      /* ignore */
    }
    return p.body ? `Чат «${title || 'AI'}» (запрос): ${p.body}` : ''
  }
  if (p.kind === 'answer') {
    return p.body ? `Ответ${title && title !== 'Ответ' ? ` «${title}»` : ''}:\n${p.body}` : ''
  }
  if (p.kind === 'kanban') {
    try {
      const board = kanbanToText(readKanban(p.extra))
      if (board.trim()) return `Канбан-доска${title ? ` «${title}»` : ''}:\n${board}`
    } catch {
      /* ignore */
    }
    return ''
  }
  if (p.kind === 'board') {
    try {
      const frame = boardToText(readBoard(p.extra))
      if (frame.trim()) return `Бэклог${title ? ` «${title}»` : ''}:\n${frame}`
    } catch {
      /* ignore */
    }
    return ''
  }
  if (p.kind === 'notebook') {
    // Ноутбук хранит ячейки в history — собираем код + вывод в читаемый текст
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cells = (JSON.parse(p.history || '{}').cells || []) as any[]
      const parts = cells
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => {
          if (c.type === 'markdown') return String(c.source || '')
          let s = '```python\n' + String(c.source || '') + '\n```'
          const outs = (c.outputs || [])
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((o: any) => (o.kind === 'image' ? '[график]' : String(o.text || '')))
            .filter(Boolean)
            .join('\n')
          if (outs) s += '\n# Вывод:\n' + outs
          return s
        })
        .filter(Boolean)
      const nbText = parts.join('\n\n')
      if (nbText) return `Jupyter-ноутбук${title ? ` «${title}»` : ''}:\n${nbText.slice(0, 12000)}`
    } catch {
      /* ignore */
    }
    return ''
  }
  const b = (p.body || '').trim()
  if (!b) return ''
  return `${title ? title + ':\n' : ''}${b}`
}

// T3.1: один источник контекста для инспектора и отправки.
export type ContextSource = { shapeId: string; kind: string; title: string; text: string; tokens: number }

// Временные (сессионные) исключения источников из контекста конкретной ноды.
// «Исключить из этого запроса» — не удаляет стрелку, живёт до перезапуска.
const contextExclusions = new Map<string, Set<string>>()
export function isSourceExcluded(nodeId: string, sourceId: string): boolean {
  return contextExclusions.get(String(nodeId))?.has(String(sourceId)) ?? false
}
export function toggleSourceExclusion(nodeId: string, sourceId: string): void {
  const key = String(nodeId)
  const set = contextExclusions.get(key) || new Set<string>()
  const sid = String(sourceId)
  if (set.has(sid)) set.delete(sid)
  else set.add(sid)
  contextExclusions.set(key, set)
}

// Собрать СТРУКТУРИРОВАННЫЙ контекст из нод, соединённых стрелкой с этим чатом — В ЛЮБУЮ
// СТОРОНУ. Любой файл/заметка/ноутбук/код/схема/ответ/память/веб-чат, связанный стрелкой,
// попадает в контекст. Исключаем: собственные ответы этого чата и skipKinds.
// ЕДИНЫЙ источник истины: и инспектор (T3.1), и отправка используют этот порядок и текст.
export function gatherChatSources(
  editor: Editor,
  nodeId: string,
  skipKinds?: Set<string>,
  memQueryVector?: number[] | null
): ContextSource[] {
  const out: ContextSource[] = []
  const seen = new Set<string>()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const touching = (editor as any).getBindingsToShape(nodeId, 'arrow') as Array<{ fromId: string }>
    for (const b of touching) {
      // оба конца этой стрелки — второй конец и есть связанная нода
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ends = (editor as any).getBindingsFromShape(b.fromId, 'arrow') as Array<{ toId: string }>
      for (const ab of ends) {
        if (ab.toId === nodeId || seen.has(ab.toId)) continue
        seen.add(ab.toId)
        const src = editor.getShape<FlowNodeShape>(ab.toId as never)
        if (!src || src.type !== 'flow-node') continue
        if (src.id === nodeId) continue // сам себя не тянем
        if (src.props.sourceId === nodeId) continue // это собственный вывод этого чата
        if (skipKinds && skipKinds.has(src.props.kind)) continue // напр. оверлей-ноды оркестратора
        let text = ''
        if (src.props.kind === 'boardmem') {
          // T2.4: не вся память, а retrieval — последние дни + релевантные старые + сводки (в бюджете).
          let bId = ''
          try {
            bId = (JSON.parse(src.props.extra || '{}') as { boardId?: string }).boardId || ''
          } catch {
            /* ignore */
          }
          const mem = buildMemoryContext(bId, memQueryVector ?? null)
          text = mem ? `Память проекта на доске:\n${mem}` : ''
        } else {
          const ctx = extractNodeContext(editor, src)
          text = ctx ? ctx.slice(0, 8000) : ''
        }
        if (!text) continue
        out.push({
          shapeId: String(src.id),
          kind: src.props.kind,
          title: ((src.props.title || '').trim() || KIND_NAME[src.props.kind] || src.props.kind).slice(0, 80),
          text,
          tokens: estimateTokens(text)
        })
      }
    }
  } catch {
    /* API отличается — не критично */
  }
  return out
}

// Текст-контекст для ОТПРАВКИ: те же источники, минус временно исключённые (T3.1).
// Порядок и содержимое совпадают с инспектором побайтово.
function gatherChatContext(editor: Editor, nodeId: string, skipKinds?: Set<string>, memQueryVector?: number[] | null): string[] {
  return gatherChatSources(editor, nodeId, skipKinds, memQueryVector)
    .filter((s) => !isSourceExcluded(nodeId, s.shapeId))
    .map((s) => s.text)
}

// Ноды, которые оркестратор НЕ должен втягивать в контекст (его собственный оверлей).
const ORCH_SKIP_KINDS = new Set(['orchtask', 'orchcall', 'orchestrator'])

// Понятные метки ролей под-агентов оркестратора (для панели выбора моделей).
const ORCH_ROLE_LABEL: Record<string, string> = {
  writer: '✍ Писатель',
  critic: '🔍 Критик',
  coder: '💻 Кодер',
  researcher: '🔬 Исследователь',
  synthesizer: '🧩 Синтезатор',
  selector: '🎯 Селектор',
  reviewer: '📝 Ревьюер',
  planner: '🗂 Планировщик'
}

const IMAGE_SIZES: Record<string, [number, number]> = {
  'Квадрат 1024': [1024, 1024],
  'Квадрат 768': [768, 768],
  'Квадрат 512': [512, 512],
  'Портрет 832×1216': [832, 1216],
  'Пейзаж 1216×832': [1216, 832]
}

function kindOf(kind: string) {
  return KINDS[kind] ?? { color: '#8e8e93', grad: 'linear-gradient(160deg,#aeaeb2,#8e8e93)', icon: '⬜' }
}

function fmtTokens(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'k'
  return String(n)
}

function useUpdate(editor: Editor, shape: FlowNodeShape) {
  return (patch: Partial<FlowNodeShape['props']>) =>
    editor.updateShape<FlowNodeShape>({ id: shape.id, type: 'flow-node', props: patch })
}

// Соединить две ноды минималистичной линией с кружками на концах
// (используем встроенную стрелку tldraw с наконечниками-точками)
function connectArrow(editor: Editor, fromId: string, toId: string) {
  try {
    const arrowId = createShapeId()
    editor.createShape({
      id: arrowId,
      type: 'arrow',
      props: {
        arrowheadStart: 'dot',
        arrowheadEnd: 'arrow',
        color: 'light-blue',
        dash: 'dashed',
        size: 's'
      }
    })
    editor.createBinding({
      fromId: arrowId,
      toId: fromId,
      type: 'arrow',
      props: { terminal: 'start', normalizedAnchor: { x: 1, y: 0.5 }, isExact: false, isPrecise: true }
    } as never)
    editor.createBinding({
      fromId: arrowId,
      toId: toId,
      type: 'arrow',
      props: { terminal: 'end', normalizedAnchor: { x: 0, y: 0.5 }, isExact: false, isPrecise: true }
    } as never)
  } catch {
    /* стрелки не критичны */
  }
}

// Геометрия «гибкой» связи: кубический безье с горизонтальными касательными,
// как в нодовых редакторах (ReactFlow/Jay Flow). Точки берём из реальных
// терминалов стрелки (учитывают привязку к нодам и их положение).
function flowEdgeGeom(editor: Editor, shape: TLArrowShape) {
  const bindings = getArrowBindings(editor, shape)
  const { start, end } = getArrowTerminalsInArrowSpace(editor, shape, bindings)
  const sx = start.x
  const sy = start.y
  const ex = end.x
  const ey = end.y
  // Чем дальше ноды по горизонтали — тем длиннее «плечо» касательной (плавнее изгиб).
  const dist = Math.max(Math.abs(ex - sx) * 0.5, 34)
  return { sx, sy, ex, ey, c1x: sx + dist, c1y: sy, c2x: ex - dist, c2y: ey }
}

function flowEdgePath(g: ReturnType<typeof flowEdgeGeom>) {
  return `M ${g.sx},${g.sy} C ${g.c1x},${g.c1y} ${g.c2x},${g.c2y} ${g.ex},${g.ey}`
}

// Переопределяем встроенную стрелку tldraw: тот же тип `arrow` и те же привязки,
// но рисуем плавную S-кривую вместо жёсткой прямой. Регистрируется в App рядом
// с FlowNodeShapeUtil и по совпадению type замещает дефолтный ArrowShapeUtil.
export class FlowArrowShapeUtil extends ArrowShapeUtil {
  override getGeometry(shape: TLArrowShape) {
    const g = flowEdgeGeom(this.editor, shape)
    const curve = new CubicBezier2d({
      start: new Vec(g.sx, g.sy),
      cp1: new Vec(g.c1x, g.c1y),
      cp2: new Vec(g.c2x, g.c2y),
      end: new Vec(g.ex, g.ey)
    })
    return new Group2d({ children: [curve] })
  }

  override component(shape: TLArrowShape) {
    const editor = this.editor
    const g = useValue('flow-edge', () => flowEdgeGeom(editor, shape), [editor, shape.id])
    const d = flowEdgePath(g)
    // Наконечник-стрелка по направлению касательной на конце.
    const ang = Math.atan2(g.ey - g.c2y, g.ex - g.c2x)
    const ah = 8
    const a1x = g.ex - ah * Math.cos(ang - Math.PI / 7)
    const a1y = g.ey - ah * Math.sin(ang - Math.PI / 7)
    const a2x = g.ex - ah * Math.cos(ang + Math.PI / 7)
    const a2y = g.ey - ah * Math.sin(ang + Math.PI / 7)
    const col = 'var(--edge, #8b93a7)'
    return (
      <SVGContainer>
        <path
          d={d}
          fill="none"
          stroke={col}
          strokeWidth={2}
          strokeLinecap="round"
          style={{ opacity: 0.85 }}
        />
        <circle cx={g.sx} cy={g.sy} r={3.5} fill={col} style={{ opacity: 0.9 }} />
        <path
          d={`M ${a1x},${a1y} L ${g.ex},${g.ey} L ${a2x},${a2y}`}
          fill="none"
          stroke={col}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ opacity: 0.9 }}
        />
      </SVGContainer>
    )
  }

  override indicator(shape: TLArrowShape) {
    return <path d={flowEdgePath(flowEdgeGeom(this.editor, shape))} />
  }
}

// Создать или обновить связанную карточку-результат (ответ ИИ / вывод кода).
// Текст кладётся в body, картинки (графики) — в extra.images.
// Сколько карточек указанного kind уже висит на источнике (для раскладки «паутиной»)
function countChildren(editor: Editor, sourceId: string, kind: string): number {
  return editor
    .getCurrentPageShapes()
    .filter(
      (s) =>
        s.type === 'flow-node' &&
        (s as FlowNodeShape).props.sourceId === sourceId &&
        (s as FlowNodeShape).props.kind === kind
    ).length
}

function ensureResultCard(
  editor: Editor,
  sourceId: string,
  content: string,
  images: string[] = []
) {
  const src = editor.getShape<FlowNodeShape>(sourceId as never)
  if (!src) return
  const extra = images.length ? JSON.stringify({ images }) : '{}'
  const bounds = editor.getShapePageBounds(sourceId as never)
  if (!bounds) return
  // Каждый запрос создаёт НОВУЮ карточку — прошлые ответы остаются на холсте,
  // раскладываются сеткой-каскадом справа и связываются стрелкой (эффект «паутины»).
  const prior = countChildren(editor, sourceId, 'answer')
  const CW = 380
  const CH = Math.max(260, src.props.h)
  const GAP = 40
  const perCol = 4
  const col = Math.floor(prior / perCol)
  const row = prior % perCol
  const id = createShapeId()
  editor.createShape<FlowNodeShape>({
    id,
    type: 'flow-node',
    x: bounds.maxX + 90 + col * (CW + GAP),
    y: bounds.y + row * (CH + GAP),
    props: {
      kind: 'answer',
      title: `Ответ ${prior + 1}`,
      body: content,
      extra,
      sourceId,
      w: CW,
      h: CH
    }
  })
  // Храним последний ответ как answerId (для «продолжить контекст»)
  editor.updateShape<FlowNodeShape>({
    id: sourceId as never,
    type: 'flow-node',
    props: { answerId: id }
  })
  connectArrow(editor, sourceId, id)
}

// Создать или обновить отдельный КВАДРАТ КОДА (из запрос-ноды).
function ensureCodeBlock(editor: Editor, requestId: string, code: string) {
  const src = editor.getShape<FlowNodeShape>(requestId as never)
  if (!src) return
  const bounds = editor.getShapePageBounds(requestId as never)
  if (!bounds) return
  // Каждая генерация — новый квадрат кода; прошлые остаются («паутина»).
  const prior = countChildren(editor, requestId, 'codeblock')
  const CW = 340
  const CH = 300
  const GAP = 40
  const perCol = 4
  const col = Math.floor(prior / perCol)
  const row = prior % perCol
  const id = createShapeId()
  editor.createShape<FlowNodeShape>({
    id,
    type: 'flow-node',
    x: bounds.maxX + 90 + col * (CW + GAP),
    y: bounds.y + row * (CH + GAP),
    props: { kind: 'codeblock', title: `Код ${prior + 1}`, body: code, sourceId: requestId, w: CW, h: CH }
  })
  editor.updateShape<FlowNodeShape>({
    id: requestId as never,
    type: 'flow-node',
    props: { answerId: id }
  })
  connectArrow(editor, requestId, id)
  editor.select(id)
}

// Создать новый ИИ-чат, ПРОДОЛЖАЮЩИЙ контекст (из карточки-ответа).
// Предыдущие вопросы-ответы остаются на холсте отдельными карточками.
function spawnFollowup(editor: Editor, answer: FlowNodeShape) {
  const src = answer.props.sourceId
    ? editor.getShape<FlowNodeShape>(answer.props.sourceId as never)
    : null
  const bounds = editor.getShapePageBounds(answer.id)
  if (!bounds) return
  const id = createShapeId()
  editor.createShape<FlowNodeShape>({
    id,
    type: 'flow-node',
    x: bounds.maxX + 90,
    y: bounds.y,
    props: {
      kind: 'ai',
      title: 'Продолжение',
      w: 300,
      h: 340,
      // Наследуем контекст источника
      model: src?.props.model ?? '',
      history: src?.props.history ?? '[]',
      contextTokens: src?.props.contextTokens ?? 0
    }
  })
  connectArrow(editor, answer.id, id)
  editor.select(id)
}

// ---------- Тело обычной ноды (заметка / документ) ----------
function SimpleBody({
  shape,
  editor,
  isEditing
}: {
  shape: FlowNodeShape
  editor: Editor
  isEditing: boolean
}) {
  const update = useUpdate(editor, shape)
  const { body } = shape.props

  if (isEditing) {
    return (
      <textarea
        className="flow-input"
        value={body}
        onChange={(e) => update({ body: e.currentTarget.value })}
        placeholder="Текст…"
        style={{
          width: '100%',
          height: '100%',
          resize: 'none',
          background: 'transparent',
          border: 'none',
          color: C.text,
          fontSize: 13.5,
          lineHeight: 1.5,
          fontFamily: 'inherit',
          outline: 'none'
        }}
      />
    )
  }
  // Просмотр — рендерим markdown (заголовки, списки, жирный, код, формулы),
  // а не сырой текст. Цвет — var(--text) через .flow-md, контраст нормальный.
  return (
    <div
      className="flow-scroll"
      onWheelCapture={stopEventPropagation}
      style={{ height: '100%', overflow: 'auto', color: C.text }}
    >
      {body ? (
        <MarkdownView content={body} />
      ) : (
        <span style={{ fontSize: 13.5, color: C.textDim }}>Двойной клик — редактировать</span>
      )}
    </div>
  )
}

// ---------- Тело карточки-ответа (текст + графики + «＋») ----------
function AnswerBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const { body } = shape.props
  const [hover, setHover] = useState(false)

  // Картинки (графики из кода) лежат в extra.images
  let images: string[] = []
  try {
    const e = JSON.parse(shape.props.extra || '{}')
    if (Array.isArray(e.images)) images = e.images
  } catch {
    /* ignore */
  }

  // «＋» (доп-вопрос) имеет смысл только для ответов ИИ
  const src = shape.props.sourceId
    ? editor.getShape<FlowNodeShape>(shape.props.sourceId as never)
    : null
  const canFollow = src?.props.kind === 'ai'

  return (
    <div
      style={{ position: 'relative', height: '100%' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        className="flow-scroll"
        onPointerDown={stopEventPropagation}
        onWheelCapture={stopEventPropagation}
        style={{
          color: C.text,
          userSelect: 'text',
          height: '100%',
          overflow: 'auto',
          paddingRight: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        <MarkdownView content={body || '…'} />
        {images.map((s, i) => (
          <img key={i} src={s} alt="" style={{ maxWidth: '100%', borderRadius: 8 }} />
        ))}
      </div>

      {/* «＋» сбоку — задать доп. вопрос, сохранив контекст */}
      {hover && canFollow && (
        <button
          className="flow-plus-btn"
          title="Задать доп. вопрос (сохранив контекст)"
          onPointerDown={stopEventPropagation}
          onClick={() => spawnFollowup(editor, shape)}
          style={{
            position: 'absolute',
            right: 2,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'linear-gradient(180deg,#409cff,#0a84ff)',
            color: '#fff',
            fontSize: 18,
            lineHeight: '1',
            fontWeight: 400,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 10px rgba(10,132,255,0.5)'
          }}
        >
          +
        </button>
      )}

      {/* Копировать текст ответа (в tldraw Ctrl+C копирует ноду, поэтому нужна кнопка) */}
      {hover && (
        <CopyBtn text={body || ''} />
      )}
    </div>
  )
}

// Кнопка «скопировать текст» — надёжный способ, минуя перехват Ctrl+C tldraw'ом
function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      title="Скопировать текст"
      onPointerDown={stopEventPropagation}
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => {
            setDone(true)
            setTimeout(() => setDone(false), 1200)
          },
          () => {
            /* clipboard недоступен */
          }
        )
      }}
      style={{
        position: 'absolute',
        right: 2,
        top: 2,
        height: 24,
        padding: '0 8px',
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.18)',
        background: done ? '#238636' : 'rgba(30,30,34,0.85)',
        color: '#fff',
        fontSize: 11,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 4
      }}
    >
      {done ? '✓ Скопировано' : '📋 Копировать'}
    </button>
  )
}

// ---------- Общий выбор модели (группировка по провайдерам) ----------
function useModels() {
  const [models, setModels] = useState<{ value: string; label: string; group: string }[]>([])
  useEffect(() => {
    window.flow?.listModels().then(setModels).catch(() => setModels([]))
  }, [])
  return models
}

function ModelSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const models = useModels()
  const groups = Array.from(new Set(models.map((m) => m.group)))
  return (
    <select
      className="flow-input"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      style={selectStyle}
    >
      <option value="">
        {models.length ? 'Модель по умолчанию' : 'Нет моделей — LM Studio / ⚙ Настройки'}
      </option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {models
            .filter((m) => m.group === g)
            .map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  )
}

// Разобрать JSON-решение модели «нужен ли поиск»
function parseDecision(text: string): { search: boolean; query: string } | null {
  try {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    const j = JSON.parse(m[0])
    return { search: !!j.search, query: String(j.query || '') }
  } catch {
    return null
  }
}

// ---------- Тело ИИ-ноды ----------
// Переиспользуемая кнопка голосового ввода (локальный Whisper).
// onText вызывается с распознанным текстом — нода сама решает, куда его вставить.
function MicButton({ onText, round }: { onText: (t: string) => void; round?: boolean }) {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')
  const [level, setLevel] = useState(0)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const rafRef = useRef<number>(0)
  const actxRef = useRef<AudioContext | null>(null)

  const stopMeter = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    actxRef.current?.close().catch(() => {})
    actxRef.current = null
    setLevel(0)
  }
  useEffect(() => () => stopMeter(), [])

  const toggle = async () => {
    if (busy) return
    if (recording) {
      recRef.current?.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Визуализация уровня звука — иконка реагирует на голос
      const actx = new AudioContext()
      actxRef.current = actx
      const analyser = actx.createAnalyser()
      analyser.fftSize = 256
      actx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.2))
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
      const mr = new MediaRecorder(stream)
      chunks.current = []
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.current.push(e.data)
      }
      mr.onstop = async () => {
        stopMeter()
        stream.getTracks().forEach((t) => t.stop())
        setRecording(false)
        const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' })
        if (!blob.size) return
        setBusy(true)
        setHint('распознаю…')
        try {
          const text = await transcribe(blob, (m) => setHint(m))
          if (text) {
            onText(text)
            setHint('')
          } else {
            setHint('пусто — говори чётче')
            setTimeout(() => setHint(''), 6000)
          }
        } catch (e) {
          console.error('[whisper]', e)
          setHint('ошибка: ' + ((e as Error)?.message || String(e)).slice(0, 90))
          setTimeout(() => setHint(''), 12000)
        } finally {
          setBusy(false)
        }
      }
      mr.start()
      recRef.current = mr
      setRecording(true)
    } catch (e) {
      console.error('[whisper] mic', e)
      setHint('нет доступа к микрофону')
      setTimeout(() => setHint(''), 5000)
    }
  }

  const active = recording
  const ring = active ? 3 + level * 20 : 0
  const spread = active ? 1 + level * 9 : 0

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={toggle}
        onPointerDown={stopEventPropagation}
        title="Голосовой ввод — локальный Whisper"
        style={
          round
            ? {
                width: 34,
                height: 34,
                borderRadius: '50%',
                border: 'none',
                cursor: 'pointer',
                display: 'grid',
                placeItems: 'center',
                fontSize: 15,
                color: active ? '#fff' : C.textDim,
                background: busy
                  ? '#3a3a3c'
                  : active
                    ? 'linear-gradient(180deg,#ff5a5a,#e0342f)'
                    : 'rgba(255,255,255,0.08)',
                boxShadow: active ? `0 0 ${ring}px ${spread}px rgba(255,70,70,${0.25 + level * 0.55})` : 'none',
                transform: active ? `scale(${1 + level * 0.18})` : 'scale(1)',
                transition: 'background .2s, box-shadow .06s, transform .06s'
              }
            : {
                alignSelf: 'flex-start',
                border: `1px solid ${active ? C.red : C.border}`,
                background: active ? 'rgba(255,80,80,0.15)' : 'rgba(255,255,255,0.05)',
                color: active ? C.red : C.textDim,
                borderRadius: 8,
                fontSize: 11,
                padding: '4px 8px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxShadow: active ? `0 0 ${ring}px rgba(255,70,70,${0.3 + level * 0.5})` : 'none'
              }
        }
      >
        {busy ? '⏳' : active ? '⏹' : '🎤'}
        {!round && ' ' + (hint || (active ? 'стоп' : 'голос'))}
      </button>
      {round && hint && (
        <div
          style={{
            position: 'absolute',
            bottom: '120%',
            right: 0,
            whiteSpace: 'nowrap',
            fontSize: 10,
            color: hint.startsWith('ошибка') ? C.red : C.textDim,
            background: C.field,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: '2px 6px',
            zIndex: 20
          }}
        >
          {hint}
        </div>
      )}
    </div>
  )
}

// ========================================================================
// «РУКИ» ИИ НА ХОЛСТЕ: модель может создавать новые ноды и заполнять
// подключённые (ноутбук, канбан, бэклог, заметки…) через блок flow-actions.
// ========================================================================
// Ноды, которые ИИ умеет заполнять/создавать.
const BUILDABLE = new Set(['notebook', 'kanban', 'board', 'note', 'doc', 'list', 'sheet', 'ai', 'code', 'diagram'])
const BUILD_SIZES: Record<string, [number, number]> = {
  note: [280, 240], doc: [280, 280], ai: [320, 340], code: [320, 240], list: [320, 340],
  sheet: [620, 380], diagram: [320, 380], kanban: [1000, 460], board: [1120, 720], notebook: [640, 600]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function connectedBuildable(editor: Editor, sourceId: string): Array<{ id: string; kind: string; title: string }> {
  const out: Array<{ id: string; kind: string; title: string }> = []
  const seen = new Set<string>()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const touching = (editor as any).getBindingsToShape(sourceId, 'arrow') as Array<{ fromId: string }>
    for (const b of touching) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ends = (editor as any).getBindingsFromShape(b.fromId, 'arrow') as Array<{ toId: string }>
      for (const ab of ends) {
        if (ab.toId === sourceId || seen.has(ab.toId)) continue
        seen.add(ab.toId)
        const s = editor.getShape<FlowNodeShape>(ab.toId as never)
        if (s?.type === 'flow-node' && BUILDABLE.has(s.props.kind)) out.push({ id: String(s.id), kind: s.props.kind, title: s.props.title })
      }
    }
  } catch {
    /* API отличается */
  }
  return out
}

// Инструкция для модели: как выдавать действия по холсту (+ список подключённых нод).
function canvasToolsPrompt(editor: Editor, sourceId: string): string {
  const conn = connectedBuildable(editor, sourceId)
  const list = conn.length
    ? conn.map((n) => `  • ${KIND_NAME[n.kind] || n.kind}${n.title ? ` «${n.title}»` : ''} [target:"${n.kind}"]`).join('\n')
    : '  (подключённых нод нет — используй только create)'
  return (
    '\n\n== ДЕЙСТВИЯ НА ХОЛСТЕ ==\n' +
    'Ты можешь СОЗДАВАТЬ новые ноды и ЗАПОЛНЯТЬ подключённые. Если пользователь просит ' +
    'сделать/создать/заполнить ноутбук, канбан, бэклог, заметку, список и т.п. — В КОНЦЕ ответа ' +
    'добавь РОВНО ОДИН блок (валидный JSON):\n' +
    '```flow-actions\n{"actions":[ ... ]}\n```\n' +
    'Формы действий:\n' +
    '- Ноутбук: {"op":"create","kind":"notebook","title":"...","cells":[{"type":"markdown","source":"# Тема"},{"type":"code","source":"import numpy as np"}]}\n' +
    '- Канбан: {"op":"create","kind":"kanban","title":"...","columns":[{"name":"Нужно сделать","cards":["задача 1","задача 2"]}]}\n' +
    '- Бэклог: {"op":"create","kind":"board","title":"...","boards":[{"name":"Доска","columns":[{"name":"Идеи","cards":["..."]}]}]}\n' +
    '- Заметка: {"op":"create","kind":"note","title":"...","body":"markdown-текст"}\n' +
    '- Заполнить ПОДКЛЮЧЁННУЮ ноду: {"op":"fill","target":"notebook"|"kanban"|"board"|"note", ...те же поля...}\n' +
    '- Найти и скачать НАУЧНЫЕ СТАТЬИ на холст (PDF-ноды), опц. залить в базу знаний AnythingLLM: ' +
    '{"op":"papers","query":"тема на английском","count":5,"toKb":true}\n' +
    'Подключённые ноды (их заполняй через fill с нужным target):\n' +
    list +
    '\nПравила: обычный текстовый ответ пиши как всегда ДО блока. Блок flow-actions — строго в самом конце, ' +
    'валидный JSON, без комментариев. Код в ячейках — рабочий Python. ' +
    'ГЛАВНОЕ: если нужная нода УЖЕ подключена (в списке выше) — ЗАПОЛНЯЙ её через op:"fill" с её target, ' +
    'НЕ создавай новую того же типа. create — только для того, чего среди подключённых нет. ' +
    'НЕ добавляй действия, если пользователь ничего строить не просил.'
  )
}

// Извлечь блок flow-actions из ответа; вернуть действия и текст без блока.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseFlowActions(text: string): { actions: any[]; clean: string } {
  const m = text.match(/```flow-actions\s*([\s\S]*?)```/)
  if (!m) return { actions: [], clean: text }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let actions: any[] = []
  try {
    const j = JSON.parse(m[1].trim())
    actions = Array.isArray(j?.actions) ? j.actions : Array.isArray(j) ? j : []
  } catch {
    /* битый JSON — игнорируем действия */
  }
  return { actions, clean: text.replace(m[0], '').trim() }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function kanbanExtraFrom(columns: any[]): string {
  const cols = (Array.isArray(columns) ? columns : []).map((c, i) => ({
    id: kbId(),
    name: String(c?.name ?? 'Колонка'),
    color: GROUP_HUES[i % GROUP_HUES.length],
    cards: (Array.isArray(c?.cards) ? c.cards : []).map((t: unknown) => ({ id: kbId(), text: String(t) }))
  }))
  return JSON.stringify({ kanban: { columns: cols.length ? cols : defaultKanban().columns } })
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function boardExtraFrom(boards: any[]): string {
  const bs = (Array.isArray(boards) ? boards : []).map((b, bi) => ({
    id: kbId(),
    name: String(b?.name ?? 'Доска'),
    color: BOARD_HUES[bi % BOARD_HUES.length],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    columns: (Array.isArray(b?.columns) ? b.columns : []).map((c: any) => ({
      id: kbId(),
      name: String(c?.name ?? 'Колонка'),
      cards: (Array.isArray(c?.cards) ? c.cards : []).map((t: unknown) => ({ id: kbId(), text: String(t) }))
    }))
  }))
  return JSON.stringify({ board: { boards: bs.length ? bs : defaultBoard().boards } })
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function notebookHistoryFrom(cells: any[]): string {
  const cs = (Array.isArray(cells) ? cells : []).map((c) => ({
    id: nbId(),
    type: c?.type === 'markdown' ? 'markdown' : 'code',
    source: String(c?.source ?? ''),
    outputs: [],
    count: null
  }))
  return JSON.stringify({ cells: cs.length ? cs : [{ id: nbId(), type: 'code', source: '', outputs: [], count: null }] })
}

// Создать новую ноду по действию create и присоединить стрелкой к источнику.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createBuiltNode(editor: Editor, sourceId: string, a: any, idx: number): void {
  const kind = String(a.kind || 'note')
  const [w, h] = BUILD_SIZES[kind] || [300, 240]
  const b = editor.getShapePageBounds(sourceId as never)
  const id = createShapeId()
  let extra = '{}'
  let bodyTxt = ''
  let history = '[]'
  if (kind === 'kanban') extra = kanbanExtraFrom(a.columns || [])
  else if (kind === 'board') extra = boardExtraFrom(a.boards || [])
  else if (kind === 'notebook') history = notebookHistoryFrom(a.cells || [])
  else bodyTxt = String(a.body ?? a.prompt ?? '')
  const x = b ? b.maxX + 90 : 0
  const y = b ? b.y + idx * (h + 40) : idx * 260
  editor.createShape<FlowNodeShape>({
    id,
    type: 'flow-node',
    x,
    y,
    props: { kind, title: String(a.title || KIND_NAME[kind] || kind), body: bodyTxt, history, extra, w, h, sourceId }
  })
  connectArrow(editor, sourceId, id)
}

// Заполнить ПОДКЛЮЧЁННУЮ ноду нужного типа (append данных).
// Ядро: заполнить КОНКРЕТНУЮ ноду по её id (append данных). Используется и flow-action
// fill, и прицельным авто-построением оркестратора (по каждой подключённой ноде).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFillToNode(editor: Editor, nodeId: string, kind: string, a: any): boolean {
  const shape = editor.getShape<FlowNodeShape>(nodeId as never)
  if (!shape) return false
  const ex = parseExtra(shape.props.extra)
  if (kind === 'kanban') {
    const cur = readKanban(shape.props.extra)
    for (const c of Array.isArray(a.columns) ? a.columns : []) {
      let col = cur.columns.find((x) => x.name.toLowerCase() === String(c?.name ?? '').toLowerCase())
      if (!col) {
        col = { id: kbId(), name: String(c?.name ?? 'Колонка'), color: GROUP_HUES[cur.columns.length % GROUP_HUES.length], cards: [] }
        cur.columns.push(col)
      }
      for (const t of Array.isArray(c?.cards) ? c.cards : []) col.cards.push({ id: kbId(), text: String(t) })
    }
    editor.updateShape<FlowNodeShape>({ id: nodeId as never, type: 'flow-node', props: { extra: JSON.stringify({ ...ex, kanban: cur }) } })
    return true
  }
  if (kind === 'board') {
    const cur = readBoard(shape.props.extra)
    for (const b of Array.isArray(a.boards) ? a.boards : []) {
      let brd = cur.boards.find((x) => x.name.toLowerCase() === String(b?.name ?? '').toLowerCase())
      if (!brd) {
        brd = { id: kbId(), name: String(b?.name ?? 'Доска'), color: BOARD_HUES[cur.boards.length % BOARD_HUES.length], columns: [] }
        cur.boards.push(brd)
      }
      for (const c of Array.isArray(b?.columns) ? b.columns : []) {
        let col = brd.columns.find((x) => x.name.toLowerCase() === String(c?.name ?? '').toLowerCase())
        if (!col) {
          col = { id: kbId(), name: String(c?.name ?? 'Колонка'), cards: [] }
          brd.columns.push(col)
        }
        for (const t of Array.isArray(c?.cards) ? c.cards : []) col.cards.push({ id: kbId(), text: String(t) })
      }
    }
    editor.updateShape<FlowNodeShape>({ id: nodeId as never, type: 'flow-node', props: { extra: JSON.stringify({ ...ex, board: cur }) } })
    return true
  }
  if (kind === 'notebook') {
    let cur: { cells: unknown[] } = { cells: [] }
    try {
      const j = JSON.parse(shape.props.history || '{}')
      if (Array.isArray(j.cells)) cur = j
    } catch {
      /* пустой */
    }
    for (const c of Array.isArray(a.cells) ? a.cells : []) {
      cur.cells.push({ id: nbId(), type: c?.type === 'markdown' ? 'markdown' : 'code', source: String(c?.source ?? ''), outputs: [], count: null })
    }
    editor.updateShape<FlowNodeShape>({ id: nodeId as never, type: 'flow-node', props: { history: JSON.stringify(cur) } })
    return true
  }
  if (kind === 'note' || kind === 'doc') {
    const prev = shape.props.body || ''
    const add = String(a.body ?? '')
    editor.updateShape<FlowNodeShape>({ id: nodeId as never, type: 'flow-node', props: { body: prev ? prev + '\n\n' + add : add } })
    return true
  }
  return false
}

// Заполнить ПОДКЛЮЧЁННУЮ ноду по действию fill (target = тип ноды).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fillConnectedNode(editor: Editor, sourceId: string, a: any): boolean {
  const target = String(a.target || '')
  const node = connectedBuildable(editor, sourceId).find((n) => n.kind === target)
  if (!node) return false
  return applyFillToNode(editor, node.id, target, a)
}

// Действие «papers»: найти статьи по запросу, скачать топ-N в PDF-ноды на холст,
// опционально залить в базу знаний AnythingLLM. Возвращает {скачано, в базу}.
async function downloadPapersAction(
  editor: Editor,
  sourceId: string,
  query: string,
  count: number,
  toKb: boolean
): Promise<{ got: number; kb: number }> {
  const q = String(query || '').trim()
  if (!q) return { got: 0, kb: 0 }
  const n = Math.max(1, Math.min(15, count || 5))
  const pr = await window.flow.papersSearch({ query: q, sources: ['openalex'], limit: n })
  if (!pr.ok) return { got: 0, kb: 0 }
  let got = 0
  let kb = 0
  let y = 0
  const b = editor.getShapePageBounds(sourceId as never)
  for (const p of pr.results.slice(0, n)) {
    try {
      const res = await window.flow.papersPdf({ doi: p.doi, pdfUrl: p.pdfUrl, source: p.source })
      if (!res.ok) continue
      const pdfId = 'pdf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      const imp = await window.flow.pdfImport({ base64: res.base64, id: pdfId })
      const extra: { pdfId: string; name: string; anyDoc?: string } = { pdfId, name: p.title }
      let nid: ReturnType<typeof createShapeId> | null = null
      if (imp.ok) {
        nid = createShapeId()
        editor.createShape<FlowNodeShape>({
          id: nid,
          type: 'flow-node',
          x: b ? b.maxX + 90 : 0,
          y: (b ? b.y : 0) + y,
          props: { kind: 'pdf', title: p.title.slice(0, 90), body: '', history: '[]', extra: JSON.stringify(extra), w: 480, h: 620, sourceId: String(sourceId) }
        })
        connectArrow(editor, sourceId, nid)
        y += 660
        got++
      }
      if (toKb) {
        const ing = await window.flow.anythingIngest({ base64: res.base64, name: p.title })
        if (ing.ok) {
          kb++
          // Привязываем документ к ноде → при её удалении уберём и из RAG AnythingLLM.
          if (nid && ing.location) {
            extra.anyDoc = ing.location
            editor.updateShape({ id: nid, type: 'flow-node', props: { extra: JSON.stringify(extra) } } as never)
          }
        }
      }
    } catch {
      /* пропускаем недоступные */
    }
  }
  return { got, kb }
}

// Применить все действия модели. Возвращает краткий отчёт (или '').
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyFlowActions(editor: Editor, sourceId: string, actions: any[]): Promise<string> {
  let created = 0
  let filled = 0
  let papersGot = 0
  let papersKb = 0
  let ci = 0
  for (const a of actions) {
    try {
      if (a?.op === 'create') {
        createBuiltNode(editor, sourceId, a, ci++)
        created++
      } else if (a?.op === 'fill') {
        if (fillConnectedNode(editor, sourceId, a)) filled++
      } else if (a?.op === 'papers') {
        const r = await downloadPapersAction(editor, sourceId, a.query, a.count, !!a.toKb)
        papersGot += r.got
        papersKb += r.kb
      }
    } catch {
      /* одно битое действие не должно ронять остальные */
    }
  }
  const parts: string[] = []
  if (created) parts.push(`создано нод: ${created}`)
  if (filled) parts.push(`заполнено нод: ${filled}`)
  if (papersGot) parts.push(`статей скачано: ${papersGot}`)
  if (papersKb) parts.push(`в AnythingLLM: ${papersKb}`)
  return parts.join(' · ')
}

// T3.1: инспектор контекста — что именно уйдёт в модель и сколько это токенов.
// Использует тот же gatherChatSources, что и отправка (состав и порядок совпадают).
function ContextInspector({
  shape,
  editor,
  model,
  ctxLimit,
  onClose
}: {
  shape: FlowNodeShape
  editor: Editor
  model: string
  ctxLimit: number
  onClose: () => void
}) {
  const [, force] = useState(0)
  const nodeId = String(shape.id)
  // T2.4: если подключена память — эмбеддим текст ноды, чтобы инспектор показал
  // именно retrieval-выборку памяти (релевантную запросу), а не всю.
  const [memVec, setMemVec] = useState<number[] | null>(null)
  useEffect(() => {
    let alive = true
    const q = (shape.props.body || '').trim()
    const hasMem = gatherChatSources(editor, nodeId).some((s) => s.kind === 'boardmem')
    if (hasMem && q) {
      embedQuery(q)
        .then((v) => {
          if (alive) setMemVec(v)
        })
        .catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [editor, nodeId, shape.props.body])
  const sources = gatherChatSources(editor, nodeId, undefined, memVec)
  const included = sources.filter((s) => !isSourceExcluded(nodeId, s.shapeId))
  const total = included.reduce((n, s) => n + s.tokens, 0)
  const over = total > ctxLimit
  const [copied, setCopied] = useState(false)
  const copyPrompt = (): void => {
    const text = included.map((s) => s.text).join('\n\n———\n\n')
    try {
      navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }
  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        right: 8,
        maxHeight: 'calc(100% - 16px)',
        zIndex: 5,
        display: 'flex',
        flexDirection: 'column',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        boxShadow: '0 16px 44px rgba(0,0,0,.5)',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 11px',
          borderBottom: `1px solid ${C.border}`
        }}
      >
        <span style={{ font: `700 12px ${NODE_SANS}`, color: C.text }}>🧮 Контекст запроса</span>
        <span style={{ flex: 1 }} />
        <span style={{ font: `600 11px ${NODE_MONO}`, color: over ? C.red : C.textDim }}>
          ≈{fmtTokens(total)} / {fmtTokens(ctxLimit)}
        </span>
        <button className="flow-mini-btn" onClick={onClose} style={miniBtnStyle} title="Закрыть">
          ✕
        </button>
      </div>
      {over && (
        <div style={{ padding: '7px 11px', font: `400 11px ${NODE_SANS}`, color: C.red, background: 'rgba(248,113,113,.1)' }}>
          ⚠ Превышен лимит модели ({model ? model.slice(0, 22) : 'локальная'}). Провайдер обрежет контекст;
          источники — в порядке добавления, при обрезке первыми страдают последние. Исключи лишнее ниже.
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {sources.length === 0 && (
          <div style={{ padding: '9px 8px', font: `400 12px ${NODE_SANS}`, color: C.textDim, lineHeight: 1.5 }}>
            Нет связанных источников. Соедини ноды (заметки, файлы, код, PDF, память доски, веб-чаты)
            стрелкой с этим чатом — их содержимое попадёт в запрос.
          </div>
        )}
        {sources.map((s) => {
          const excluded = isSourceExcluded(nodeId, s.shapeId)
          return (
            <label
              key={s.shapeId}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 6,
                cursor: 'pointer',
                opacity: excluded ? 0.45 : 1
              }}
            >
              <input
                type="checkbox"
                checked={!excluded}
                onChange={() => {
                  toggleSourceExclusion(nodeId, s.shapeId)
                  force((n) => n + 1)
                }}
                style={{ marginTop: 2 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `500 12px ${NODE_SANS}`, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.title}
                </div>
                <div style={{ font: `400 10px ${NODE_MONO}`, color: C.textDim }}>
                  {KIND_NAME[s.kind] || s.kind} · ≈{fmtTokens(s.tokens)} ток.
                </div>
              </div>
            </label>
          )
        })}
      </div>
      <div style={{ padding: '7px 11px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="flow-mini-btn" onClick={copyPrompt} style={miniBtnStyle} disabled={!included.length}>
          {copied ? 'Скопировано ✓' : 'Скопировать промпт целиком'}
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ font: `400 10px ${NODE_MONO}`, color: C.textDim }}>
          {included.length}/{sources.length} источн.
        </span>
      </div>
    </div>
  )
}

function AiBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  const { body, model, contextTokens } = shape.props
  let ex: { webAuto?: boolean; tools?: boolean; build?: boolean; sci?: boolean } = {}
  try {
    ex = JSON.parse(shape.props.extra || '{}')
  } catch {
    /* ignore */
  }
  const webAuto = !!ex.webAuto
  const toolsOn = !!ex.tools
  const buildOn = !!ex.build
  const sciOn = !!(ex as { sci?: boolean }).sci
  const setEx = (patch: Record<string, unknown>) =>
    update({ extra: JSON.stringify({ ...ex, ...patch }) })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Вложения к следующему сообщению: фото (→ vision) и текстовые файлы (→ контекст)
  const [attach, setAttach] = useState<Attachment[]>([])
  const attachInput = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false) // T3.1: инспектор контекста
  const ctxLimit = contextLimitFor(model)

  const flash = (msg: string) => {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }

  const addFiles = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach((f) => {
      const r = new FileReader()
      if (f.type.startsWith('image/') || IMG_EXT.test(f.name)) {
        r.onload = () =>
          setAttach((a) => [...a, { id: attId(), kind: 'image', name: f.name, dataUrl: String(r.result) }])
        r.readAsDataURL(f)
      } else if (DOC_EXT.test(f.name)) {
        // PDF / Word / PowerPoint — извлекаем текст в главном процессе
        r.onload = async () => {
          const base64 = String(r.result).split(',')[1] || ''
          flash(`📄 Извлекаю текст из «${f.name}»…`)
          try {
            const res = await window.flow.extractDoc({ base64, name: f.name })
            if (res.ok) {
              setAttach((a) => [...a, { id: attId(), kind: 'file', name: f.name, text: res.text }])
              flash(`✅ «${f.name}» прикреплён`)
            } else {
              flash(`«${f.name}»: ${res.error}`)
            }
          } catch (e) {
            flash(`«${f.name}»: ${String(e)}`)
          }
        }
        r.readAsDataURL(f)
      } else if (TEXT_EXT.test(f.name)) {
        r.onload = () =>
          setAttach((a) => [...a, { id: attId(), kind: 'file', name: f.name, text: String(r.result).slice(0, 20000) }])
        r.readAsText(f)
      } else {
        // Любой другой формат: пытаемся прочитать как текст; бинарь — прикрепляем как факт-вложение
        r.onload = () => {
          const raw = String(r.result || '')
          const sample = raw.slice(0, 4000)
          let bad = 0
          for (let i = 0; i < sample.length; i++) {
            const c = sample.charCodeAt(i)
            if (c === 0xfffd || c < 9 || (c > 13 && c < 32)) bad++
          }
          const binary = sample.length > 0 && bad / sample.length > 0.1
          if (binary || !raw.trim()) {
            const kb = Math.max(1, Math.round(f.size / 1024))
            setAttach((a) => [
              ...a,
              {
                id: attId(),
                kind: 'file',
                name: f.name,
                text: `[бинарный файл «${f.name}», ${kb} КБ — текст не извлекается]`
              }
            ])
            flash(`📎 «${f.name}» прикреплён (бинарный, ${kb} КБ)`)
          } else {
            setAttach((a) => [...a, { id: attId(), kind: 'file', name: f.name, text: raw.slice(0, 20000) }])
            flash(`✅ «${f.name}» прикреплён`)
          }
        }
        r.readAsText(f)
      }
    })
  }

  const run = async () => {
    if (!body.trim() || loading) return
    setError(null)
    setLoading(true)
    try {
      const history: ChatMessage[] = JSON.parse(shape.props.history || '[]')

      // Авто-поиск: модель сама решает, нужен ли веб-поиск
      let searchContext = ''
      if (webAuto) {
        flash('🔎 Проверяю, нужен ли поиск…')
        const decSys =
          'Реши, нужен ли веб-поиск для точного ответа (актуальные события, свежие факты, цены, новости, то что меняется во времени). ' +
          'Ответь СТРОГО одним JSON без пояснений: {"search": true|false, "query": "поисковый запрос"}.'
        const dec = await window.flow.aiChat({
          model,
          messages: [
            { role: 'system', content: decSys },
            { role: 'user', content: body }
          ]
        })
        if (dec.ok) {
          const parsed = parseDecision(dec.content)
          if (parsed?.search && parsed.query) {
            flash('🔎 Ищу в вебе…')
            const sr = await window.flow.webSearch({ query: parsed.query })
            if (sr.ok && sr.results.length) {
              searchContext = sr.results
                .map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${x.snippet}`)
                .join('\n\n')
            }
          }
        }
      }

      // Авто-поиск научных статей: модель сама решает, нужны ли статьи
      let sciContext = ''
      if (sciOn) {
        flash('🔬 Проверяю, нужны ли статьи…')
        const decSys =
          'Реши, помогут ли научные статьи (журналы, arXiv, PubMed) точно ответить на запрос. ' +
          'Ответь СТРОГО одним JSON без пояснений: {"search": true|false, "query": "поисковый запрос на английском по теме"}.'
        const dec = await window.flow.aiChat({ model, messages: [{ role: 'system', content: decSys }, { role: 'user', content: body }] })
        if (dec.ok) {
          const parsed = parseDecision(dec.content)
          if (parsed?.search && parsed.query) {
            flash('🔬 Ищу научные статьи…')
            const pr = await window.flow.papersSearch({ query: parsed.query, sources: ['openalex'], limit: 8 })
            if (pr.ok && pr.results.length) {
              sciContext = pr.results
                .map(
                  (p, i) =>
                    `[S${i + 1}] ${p.title} (${p.authors.slice(0, 3).join(', ')}${p.year ? ', ' + p.year : ''})` +
                    (p.doi ? `\nDOI: ${p.doi}` : '') +
                    (p.abstract ? `\n${p.abstract.slice(0, 700)}` : '')
                )
                .join('\n\n')
            }
          }
        }
      }

      // Собираем сообщения для финального ответа (поиск вставляем только на этот ход)
      const finalMessages: ChatMessage[] = [...history]
      if (searchContext) {
        finalMessages.push({
          role: 'system',
          content:
            'Актуальные результаты веб-поиска для ответа:\n' +
            searchContext +
            '\nОпирайся на них и ссылайся на источники как [1], [2].'
        })
      }
      if (sciContext) {
        finalMessages.push({
          role: 'system',
          content:
            'Научные статьи по теме (используй как источники, ссылайся как [S1], [S2] с DOI):\n' +
            sciContext
        })
      }
      // Контекст от связанных чатов/нод: стрелки, ведущие В этот чат.
      // T2.4: если подключена нода памяти — эмбеддим вопрос, чтобы подтянуть релевантные
      // старые выжимки (а не всю память). Модель эмбеддингов грузим только при наличии памяти.
      let memVec: number[] | null = null
      try {
        const hasMem = gatherChatSources(editor, shape.id).some((s) => s.kind === 'boardmem')
        if (hasMem && body.trim()) memVec = await embedQuery(body).catch(() => null)
      } catch {
        /* без релевантности — фолбэк на последние + сводки */
      }
      const linked = gatherChatContext(editor, shape.id, undefined, memVec)
      if (linked.length) {
        flash(`🔗 Подхватил контекст: ${linked.length} ${linked.length === 1 ? 'источник' : 'источника(ов)'}`)
        finalMessages.push({
          role: 'system',
          content:
            'Пользователь прикрепил к этому чату материалы стрелками на холсте — они приведены ниже ' +
            '(это могут быть заметки, файлы, код, Jupyter-ноутбуки и т.п.). ' +
            'Когда пользователь говорит «этот ноутбук», «этот код», «этот файл», «объясни это» и подобное — ' +
            'он имеет в виду ИМЕННО эти материалы, а не физическое устройство или что-то стороннее. ' +
            'Отвечай прямо по ним и НЕ переспрашивай, что имеется в виду.\n\n' +
            linked.join('\n\n———\n\n')
        })
      }

      // Вложенные текстовые файлы — в контекст
      const fileParts = attach.filter((a) => a.kind === 'file' && a.text)
      if (fileParts.length) {
        finalMessages.push({
          role: 'system',
          content:
            'Вложенные пользователем файлы (используй их как контекст):\n\n' +
            fileParts.map((a) => `=== ${a.name} ===\n${a.text}`).join('\n\n')
        })
      }
      // Режим «строить на холсте»: даём модели инструкцию про действия + список
      // подключённых нод, которые можно заполнять.
      if (buildOn) {
        finalMessages.push({ role: 'system', content: canvasToolsPrompt(editor, shape.id) })
      }
      finalMessages.push({ role: 'user', content: body })

      // Вложенные изображения — в vision (поддерживает aiChat)
      const imgs = attach.filter((a) => a.kind === 'image' && a.dataUrl).map((a) => a.dataUrl as string)

      if (toolsOn) flash('🔧 Работаю с инструментами…')
      const res = toolsOn
        ? await window.flow.agentChat({ model, messages: finalMessages })
        : await window.flow.aiChat({ model, messages: finalMessages, images: imgs.length ? imgs : undefined })
      if (!res.ok) {
        setError(res.error)
        return
      }
      // Режим «строить»: вычленяем действия, создаём/заполняем ноды, а в ответ
      // кладём текст без служебного блока + краткий отчёт о постройке.
      let answerText = res.content
      if (buildOn) {
        const { actions, clean } = parseFlowActions(res.content)
        if (actions.length) {
          flash('🛠 Строю на холсте…')
          const report = await applyFlowActions(editor, shape.id, actions)
          answerText = (clean || '').trim() + (report ? `\n\n> 🛠 ${report}` : '')
        }
      }
      // В историю кладём только реальный диалог (без вставленного поиска)
      const newHistory: ChatMessage[] = [
        ...history,
        { role: 'user', content: body },
        { role: 'assistant', content: answerText }
      ]
      const tokens = res.totalTokens || Math.round(JSON.stringify(newHistory).length / 4)
      ensureResultCard(editor, shape.id, answerText)
      setAttach([]) // вложения использованы
      if (tokens >= ctxLimit) {
        // Достигли лимита — начинаем контекст заново
        update({ history: '[]', contextTokens: 0 })
        flash(`Контекст достиг ${fmtTokens(ctxLimit)} — диалог начат заново`)
      } else {
        update({ history: JSON.stringify(newHistory), contextTokens: tokens })
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const resetContext = () => {
    update({ history: '[]', contextTokens: 0 })
    flash('Контекст очищен')
  }

  // Полоска контекста
  const pct = Math.min(contextTokens / ctxLimit, 1)
  const meterColor = pct < 0.6 ? C.green : pct < 0.85 ? C.amber : C.red

  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', position: 'relative' }}
    >
      {inspectorOpen && (
        <ContextInspector shape={shape} editor={editor} model={model} ctxLimit={ctxLimit} onClose={() => setInspectorOpen(false)} />
      )}
      {/* Выбор модели (LM Studio + API-провайдеры) */}
      <ModelSelect value={model} onChange={(v) => update({ model: v })} />

      {/* Чипы вложений */}
      {attach.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {attach.map((a) => (
            <span
              key={a.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                color: C.text,
                background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                padding: '3px 7px'
              }}
            >
              {a.kind === 'image' && a.dataUrl ? (
                <img src={a.dataUrl} alt="" style={{ width: 16, height: 16, borderRadius: 3, objectFit: 'cover' }} />
              ) : (
                '📄'
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                {a.name}
              </span>
              <span
                onClick={() => setAttach((x) => x.filter((y) => y.id !== a.id))}
                style={{ cursor: 'pointer', color: C.textDim }}
              >
                ✕
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Композер — как у современных чатов: поле + панель инструментов */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          addFiles(e.dataTransfer.files)
        }}
        style={{
          position: 'relative',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          background: C.field,
          border: `1px solid ${dragOver ? C.blue : C.border}`,
          borderRadius: 12,
          padding: 10,
          minHeight: 150
        }}
      >
        <textarea
          className="flow-input"
          value={body}
          onChange={(e) => update({ body: e.currentTarget.value })}
          placeholder="Спроси что-нибудь…"
          style={{
            flex: 1,
            resize: 'none',
            minHeight: 92,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: C.text,
            fontSize: 13.5,
            lineHeight: 1.55,
            fontFamily: 'inherit'
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* «＋» меню: прикрепить / веб-поиск / MCP */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              onPointerDown={stopEventPropagation}
              title="Добавить"
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                border: `1px solid ${C.border}`,
                background: menuOpen ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)',
                color: C.text,
                fontSize: 17,
                lineHeight: 1,
                cursor: 'pointer',
                display: 'grid',
                placeItems: 'center'
              }}
            >
              ＋
            </button>
            {menuOpen && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '120%',
                  left: 0,
                  zIndex: 30,
                  minWidth: 210,
                  background: C.field,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  boxShadow: '0 10px 30px rgba(0,0,0,0.45)'
                }}
              >
                <button
                  onClick={() => {
                    attachInput.current?.click()
                    setMenuOpen(false)
                  }}
                  style={menuItemStyle}
                >
                  📎 Прикрепить файл / фото
                </button>
                <button onClick={() => setEx({ webAuto: !webAuto })} style={menuItemStyle}>
                  {webAuto ? '✅' : '🔎'}&nbsp; Веб-поиск {webAuto ? '· вкл' : '· выкл'}
                </button>
                <button onClick={() => setEx({ tools: !toolsOn })} style={menuItemStyle}>
                  {toolsOn ? '✅' : '🔧'}&nbsp; Инструменты MCP {toolsOn ? '· вкл' : '· выкл'}
                </button>
                <button onClick={() => setEx({ build: !buildOn })} style={menuItemStyle}>
                  {buildOn ? '✅' : '🛠'}&nbsp; Строить на холсте {buildOn ? '· вкл' : '· выкл'}
                </button>
                <button onClick={() => setEx({ sci: !sciOn })} style={menuItemStyle}>
                  {sciOn ? '✅' : '🔬'}&nbsp; Научный поиск {sciOn ? '· вкл' : '· выкл'}
                </button>
              </div>
            )}
          </div>

          {/* Активные режимы */}
          {webAuto && (
            <span title="Веб-поиск включён" style={pillStyle}>
              🔎
            </span>
          )}
          {toolsOn && (
            <span title="MCP включены" style={pillStyle}>
              🔧
            </span>
          )}
          {buildOn && (
            <span title="ИИ создаёт/заполняет ноды на холсте" style={pillStyle}>
              🛠
            </span>
          )}
          {sciOn && (
            <span title="Научный поиск статей включён" style={pillStyle}>
              🔬
            </span>
          )}

          <div style={{ flex: 1 }} />

          {/* Голос — снизу справа, реагирует на голос */}
          <MicButton
            round
            onText={(t) => {
              const cur = ((editor.getShape(shape.id) as FlowNodeShape | undefined)?.props.body as string) || ''
              update({ body: cur ? cur.replace(/\s*$/, '') + ' ' + t : t })
            }}
          />

          {/* Отправить */}
          <button
            onClick={run}
            onPointerDown={stopEventPropagation}
            disabled={loading}
            title="Отправить"
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              border: 'none',
              cursor: loading ? 'default' : 'pointer',
              color: '#fff',
              fontSize: 15,
              display: 'grid',
              placeItems: 'center',
              background: loading ? '#3a3a3c' : 'linear-gradient(180deg,#0a90ff,#0060df)',
              boxShadow: loading ? 'none' : '0 2px 8px rgba(10,132,255,0.35)'
            }}
          >
            {loading ? '⏳' : '➤'}
          </button>
        </div>
      </div>

      <input
        ref={attachInput}
        type="file"
        multiple
        accept="*/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          addFiles(e.target.files)
          e.currentTarget.value = ''
        }}
      />

      {/* Счётчик контекста — привязан к модели */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10.5, color: C.textDim, letterSpacing: '0.02em' }}>
            КОНТЕКСТ · {model ? model.slice(0, 18) : 'локальная'}
          </span>
          <span style={{ fontSize: 10.5, color: C.textDim }}>
            {fmtTokens(contextTokens)} / {fmtTokens(ctxLimit)}
            <button
              className="flow-mini-btn"
              onClick={() => setInspectorOpen((v) => !v)}
              title="Инспектор контекста: что уйдёт в модель"
              style={miniBtnStyle}
            >
              🧮 контекст
            </button>
            <button className="flow-mini-btn" onClick={resetContext} title="Очистить контекст" style={miniBtnStyle}>
              сброс
            </button>
          </span>
        </div>
        <div style={{ height: 4, borderRadius: 3, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${pct * 100}%`,
              background: meterColor,
              borderRadius: 3,
              transition: 'width .3s ease, background .3s'
            }}
          />
        </div>
      </div>

      {notice && <div style={{ fontSize: 11, color: C.amber }}>{notice}</div>}
      {error && <div style={{ fontSize: 11, color: C.red, whiteSpace: 'pre-wrap' }}>{error}</div>}
    </div>
  )
}

const fieldStyle = {
  background: C.field,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  color: C.text,
  fontSize: 12.5,
  fontFamily: 'inherit',
  padding: '7px 9px',
  outline: 'none'
} as const

const selectStyle = { ...fieldStyle, cursor: 'pointer' } as const

const miniBtnStyle = {
  marginLeft: 8,
  border: 'none',
  background: 'rgba(255,255,255,0.08)',
  color: C.textDim,
  borderRadius: 5,
  fontSize: 10,
  padding: '1px 6px',
  cursor: 'pointer'
} as const

const menuItemStyle = {
  border: 'none',
  background: 'transparent',
  color: C.text,
  fontSize: 12,
  textAlign: 'left' as const,
  padding: '7px 9px',
  borderRadius: 7,
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const
} as const

const pillStyle = {
  fontSize: 12,
  padding: '2px 6px',
  borderRadius: 6,
  background: 'rgba(80,150,255,0.16)',
  border: `1px solid ${C.border}`
} as const

// Разобрать JSON из props.extra (не падаем на кривом JSON)
function parseExtra(s: string): Record<string, string> {
  try {
    return JSON.parse(s || '{}')
  } catch {
    return {}
  }
}

// T1.2: прогнать все flow-node доски через схему+миграции extra. Повреждённые ноды
// (невалидный JSON/не-объект) помечаются и рендерятся заглушкой; мигрированные — extra
// однократно перезаписывается (тихо, без засорения undo). Идемпотентно; безопасно
// вызывать после каждой загрузки снапшота.
export function migrateBoardExtras(editor: Editor): { migrated: number; corrupt: number } {
  let migrated = 0
  let corrupt = 0
  const updates: { id: FlowNodeShape['id']; type: 'flow-node'; props: { extra: string } }[] = []
  for (const s of editor.getCurrentPageShapes()) {
    if (s.type !== 'flow-node') continue
    const fs = s as FlowNodeShape
    const id = String(fs.id)
    const res = parseAndMigrateExtra(fs.props.kind, fs.props.extra || '{}')
    if (res.status === 'corrupt') {
      markCorrupt(id, res.raw)
      corrupt++
      continue
    }
    clearCorrupt(id)
    if (res.status === 'migrated' && res.json !== fs.props.extra) {
      updates.push({ id: fs.id, type: 'flow-node', props: { extra: res.json } })
      migrated++
    }
  }
  if (updates.length) {
    // Применяем как «удалённые» изменения — без записи в undo-историю пользователя.
    const store = editor.store as unknown as { mergeRemoteChanges?: (fn: () => void) => void }
    if (typeof store.mergeRemoteChanges === 'function') {
      store.mergeRemoteChanges(() => editor.updateShapes(updates))
    } else {
      editor.updateShapes(updates)
    }
  }
  return { migrated, corrupt }
}

// Убрать markdown-ограждение ```<язык> … ``` из ответа модели (python, mermaid и т.п.)
function stripFences(text: string): string {
  const m = text.match(/```(?:[a-zA-Z]+)?\s*([\s\S]*?)```/)
  return (m ? m[1] : text).trim()
}

// ---------- Запрос-нода: описание → генерация кода в ОТДЕЛЬНЫЙ квадрат ----------
function CodeRequestBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  const { model } = shape.props
  const instruction = parseExtra(shape.props.extra).instruction ?? ''
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setInstruction = (v: string) => update({ extra: JSON.stringify({ instruction: v }) })

  const generate = async () => {
    if (!instruction.trim() || generating) return
    setError(null)
    setGenerating(true)
    try {
      const sys =
        'Ты — генератор Python-кода. Отвечай ТОЛЬКО рабочим кодом на Python, без пояснений и без markdown-разметки. ' +
        'ВАЖНО: окружение неинтерактивное — НЕ используй input() и чтение с клавиатуры. ' +
        'Если нужно приложение с интерфейсом (например калькулятор) — используй tkinter (откроется отдельное окно). ' +
        'Иначе выводи результат через print() с готовыми примерами. Комментарии на русском допустимы.'
      const res = await window.flow.aiChat({
        model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: instruction }
        ]
      })
      if (res.ok) ensureCodeBlock(editor, shape.id, stripFences(res.content))
      else setError(res.error)
    } catch (e) {
      setError(String(e))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}
    >
      <ModelSelect value={model} onChange={(v) => update({ model: v })} />

      <textarea
        className="flow-input flow-scroll"
        value={instruction}
        onChange={(e) => setInstruction(e.currentTarget.value)}
        placeholder="🤖 Опиши, что написать (напр. «калькулятор на tkinter»)…"
        style={{ ...fieldStyle, flex: 1, minHeight: 60, resize: 'none', lineHeight: 1.45 }}
      />

      <MicButton onText={(t) => setInstruction((p) => (p ? p.replace(/\s*$/, '') + ' ' + t : t))} />

      <button
        className="flow-run-btn"
        onClick={generate}
        disabled={generating}
        style={{
          cursor: generating ? 'default' : 'pointer',
          border: 'none',
          borderRadius: 10,
          padding: '9px',
          fontSize: 13,
          fontWeight: 600,
          color: '#fff',
          background: generating ? '#3a3a3c' : 'linear-gradient(180deg,#409cff,#0a84ff)',
          boxShadow: generating ? 'none' : '0 2px 8px rgba(10,132,255,0.3)',
          transition: 'filter .15s, transform .05s'
        }}
      >
        {generating ? '🤖 Пишу код…' : '🤖 Сгенерировать код →'}
      </button>

      {error && <div style={{ fontSize: 11, color: C.red, whiteSpace: 'pre-wrap' }}>{error}</div>}
    </div>
  )
}

// ---------- Квадрат кода: код + запуск → квадрат результата ----------
function CodeBlockBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  const { body } = shape.props
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (running) return
    setError(null)
    setRunning(true)
    try {
      const res = await window.flow.runCode({ id: shape.id, code: body })
      if (res.ok) {
        ensureResultCard(
          editor,
          shape.id,
          res.stdout || '(выполнено без текстового вывода)',
          res.images
        )
      } else if (!res.killed) {
        setError(res.error)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}
    >
      <textarea
        className="flow-input flow-scroll"
        value={body}
        spellCheck={false}
        onChange={(e) => update({ body: e.currentTarget.value })}
        placeholder={'# код появится здесь\n# можно править вручную'}
        style={{
          ...fieldStyle,
          flex: 1,
          minHeight: 90,
          resize: 'none',
          whiteSpace: 'pre',
          overflow: 'auto',
          fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", ui-monospace, monospace',
          fontSize: 13,
          lineHeight: 1.55,
          textRendering: 'optimizeLegibility'
        }}
      />
      <button
        className="flow-run-btn"
        onClick={run}
        disabled={running}
        style={{
          cursor: running ? 'default' : 'pointer',
          border: 'none',
          borderRadius: 10,
          padding: '9px',
          fontSize: 13,
          fontWeight: 600,
          color: '#fff',
          background: running ? '#3a3a3c' : 'linear-gradient(180deg,#7d7bff,#5e5ce6)',
          boxShadow: running ? 'none' : '0 2px 8px rgba(94,92,230,0.35)',
          transition: 'filter .15s, transform .05s'
        }}
      >
        {running ? '⏳ Выполняю…' : '▶  Запустить код'}
      </button>

      {error && <div style={{ fontSize: 11, color: C.red, whiteSpace: 'pre-wrap' }}>{error}</div>}
    </div>
  )
}

// ---------- Тело поиск-ноды (веб-поиск + ответ с источниками) ----------
type SciPaper = {
  id: string
  source: string
  title: string
  authors: string[]
  year: number | null
  abstract: string
  doi: string
  url: string
  pdfUrl: string
  oa: boolean
  venue: string
}

function SearchBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  const { body, model } = shape.props // body = запрос
  const [results, setResults] = useState<{ title: string; url: string; snippet: string }[]>([])
  const [loading, setLoading] = useState<'' | 'search' | 'answer'>('')
  const [error, setError] = useState<string | null>(null)
  // Научный поиск (статьи из журналов)
  const [papers, setPapers] = useState<SciPaper[]>([])
  const [sciLoading, setSciLoading] = useState(false)
  // Поиск — через OpenAlex (покрывает Elsevier и др.). Elsevier-Search требует
  // отдельного права API-ключа (часто 401), а полный текст качается по DOI и так.
  const [useElsevier, setUseElsevier] = useState(false)
  const [dl, setDl] = useState<string>('') // id статьи, которая скачивается
  const [sciNote, setSciNote] = useState<string>('') // диагностика источников (напр. Elsevier)
  const [kbBusy, setKbBusy] = useState(false)
  const [kbMsg, setKbMsg] = useState('')

  const searchPapers = async () => {
    if (!body.trim() || sciLoading) return
    setError(null)
    setPapers([])
    setSciNote('')
    setSciLoading(true)
    const sources = ['openalex']
    if (useElsevier) sources.push('elsevier')
    try {
      // Локальная чистка запроса — работает БЕЗ модели: убираем «мусорные» слова
      // (собери/найди/статьи/по/за/год…) и 4-значные годы (они уходят в фильтр по дате).
      // Иначе OpenAlex ищет по целой фразе-предложению и находит 0.
      const STOPWORDS = new Set([
        'собери','сбери','найди','найти','подбери','подбор','покажи','дай','нужны','нужно','хочу',
        'статьи','статья','статей','работы','работа','публикации','публикация','исследования','исследование','литература','обзор',
        'по','о','об','обо','про','за','год','года','году','лет','на','тему','теме','темы','для','и','в','с','из','к','от',
        'find','search','papers','paper','articles','article','about','on','for','the','a','an','of','in','to','year','years','please'
      ])
      const cleanQuery = (s: string): string => {
        const c = s
          .replace(/\b20\d{2}\b/g, ' ')
          .replace(/[«»"'`.,;:!?()[\]]/g, ' ')
          .split(/\s+/)
          .filter((w) => w && !STOPWORDS.has(w.toLowerCase()))
          .join(' ')
          .trim()
        return c || s.trim()
      }
      // Естественный запрос → английские ключевые слова (OpenAlex ищет по ним точнее,
      // и результаты идут из международных журналов, а не русских репозиториев).
      // Базовый запрос — уже очищенный (на случай, если ни одна модель недоступна).
      let q = cleanQuery(body)
      try {
        const messages = [
          {
            role: 'system' as const,
            content:
              'Извлеки из запроса пользователя КЛЮЧЕВЫЕ СЛОВА для поиска научных статей, ПЕРЕВЕДИ на английский. ' +
              'Ответь ТОЛЬКО строкой из 2–6 ключевых слов через пробел, без кавычек и пояснений. ' +
              'Убери слова вроде «найди», «статьи», числа.'
          },
          { role: 'user' as const, content: body }
        ]
        // Пробуем модель ноды; если её провайдер недоступен (напр. мёртвый ключ) —
        // повторяем на модели по умолчанию (пустой model → берётся defaultModel).
        let dec = await window.flow.aiChat({ model, messages })
        if (!dec.ok) dec = await window.flow.aiChat({ model: '', messages })
        if (dec.ok) {
          const kw = dec.content.trim().replace(/^["'`]|["'`]$/g, '').replace(/\s+/g, ' ').slice(0, 120)
          // Берём ответ модели, только если это латиница (реальный перевод), а не «извинения».
          if (kw && /[a-z]/i.test(kw)) q = kw
        }
      } catch {
        /* без модели ищем по очищенному тексту */
      }
      // Год из исходного запроса (напр. «2025-2026») → фильтр по дате публикации.
      const years = (body.match(/\b(20\d{2})\b/g) || []).map(Number).filter((y) => y >= 1990 && y <= 2035)
      const yearFrom = years.length ? Math.min(...years) : undefined
      const yearTo = years.length ? Math.max(...years) : undefined
      const res = await window.flow.papersSearch({ query: q, sources, limit: 25, yearFrom, yearTo })
      if (res.ok) {
        setPapers(res.results)
        const yr = yearFrom ? ` · ${yearFrom}${yearTo && yearTo !== yearFrom ? '–' + yearTo : ''}` : ''
        setSciNote((res.note ? res.note + '\n' : '') + (res.results.length ? `🔎 запрос: «${q}»${yr}` : ''))
        if (!res.results.length) setError('Ничего не найдено. Попробуй короче/по-английски (напр. «AI agents LLM») или сними ограничение по году.')
      } else setError(res.error)
    } catch (e) {
      setError(String(e))
    } finally {
      setSciLoading(false)
    }
  }

  // Скачать одну статью → PDF-нода. yOffset — вертикальный сдвиг (для пачки).
  // Скачивает статью в PDF-ноду на доску. Если toKb — ещё и заливает в AnythingLLM
  // и привязывает документ к ноде (extra.anyDoc), чтобы удаление ноды убрало его из RAG.
  const fetchToNode = async (p: SciPaper, yOffset: number, toKb = false): Promise<{ node: boolean; kb: boolean }> => {
    const res = await window.flow.papersPdf({ doi: p.doi, pdfUrl: p.pdfUrl, source: p.source })
    if (!res.ok) return { node: false, kb: false }
    const pdfId = 'pdf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const imp = await window.flow.pdfImport({ base64: res.base64, id: pdfId })
    if (!imp.ok) return { node: false, kb: false }
    const b = editor.getShapePageBounds(shape.id as never)
    const nid = createShapeId()
    const extra: { pdfId: string; name: string; anyDoc?: string } = { pdfId, name: p.title }
    editor.createShape<FlowNodeShape>({
      id: nid,
      type: 'flow-node',
      x: b ? b.maxX + 80 : 0,
      y: (b ? b.y : 0) + yOffset,
      props: {
        kind: 'pdf',
        title: p.title.slice(0, 90),
        body: '',
        history: '[]',
        extra: JSON.stringify(extra),
        w: 480,
        h: 620,
        sourceId: String(shape.id)
      }
    })
    connectArrow(editor, shape.id, nid)
    let kb = false
    if (toKb) {
      const ing = await window.flow.anythingIngest({ base64: res.base64, name: p.title })
      if (ing.ok) {
        kb = true
        if (ing.location) {
          extra.anyDoc = ing.location
          editor.updateShape({ id: nid, type: 'flow-node', props: { extra: JSON.stringify(extra) } } as never)
        }
      }
    }
    return { node: true, kb }
  }

  const downloadPaper = async (p: SciPaper) => {
    if (dl) return
    setDl(p.id)
    setError(null)
    try {
      const r = await fetchToNode(p, 0)
      if (!r.node) setError('PDF недоступен (нет open-access и не сработал доступ по подписке)')
    } catch (e) {
      setError(String(e))
    } finally {
      setDl('')
    }
  }

  // Скачать все найденные статьи (до 15) на доску PDF-нодами И залить в AnythingLLM.
  // Каждый документ привязан к своей ноде (extra.anyDoc) — удалишь ноду, уйдёт и из RAG.
  const downloadAllToKb = async () => {
    if (dl || kbBusy) return
    setKbMsg('')
    setKbBusy(true)
    const batch = papers.slice(0, 15)
    let nodes = 0
    let kb = 0
    let y = 0
    for (const p of batch) {
      try {
        const r = await fetchToNode(p, y, true)
        if (r.node) {
          nodes++
          y += 660
        }
        if (r.kb) kb++
      } catch {
        /* пропускаем недоступные */
      }
    }
    setKbBusy(false)
    if (kb) {
      setKbMsg(`📚 ${kb} из ${batch.length} в AnythingLLM + на доске (нода = документ, удалишь ноду — уйдёт из базы)`)
    } else if (nodes) {
      setKbMsg(`Ноды созданы (${nodes}), но в AnythingLLM не залилось — запущен ли он и указан ли API-ключ?`)
    } else {
      setKbMsg('❌ PDF не скачались — нет open-access/подписки на эти статьи')
    }
  }

  // Скачать пачкой все найденные статьи (до 15) на доску столбиком.
  const downloadAll = async () => {
    if (dl) return
    setError(null)
    const batch = papers.slice(0, 15)
    let done = 0
    let y = 0
    for (const p of batch) {
      setDl('all:' + p.id)
      try {
        const r = await fetchToNode(p, y)
        if (r.node) {
          done++
          y += 660 // высота PDF-ноды + отступ
        }
      } catch {
        /* пропускаем недоступные */
      }
    }
    setDl('')
    setError(done ? `Скачано ${done} из ${batch.length} (остальные без доступа/OA)` : 'Ни одна статья не скачалась (нет доступа/OA)')
  }

  const doSearch = async () => {
    const res = await window.flow.webSearch({ query: body })
    if (!res.ok) {
      setError(res.error)
      return null
    }
    setResults(res.results)
    return res.results
  }

  const search = async () => {
    if (!body.trim() || loading) return
    setError(null)
    setResults([])
    setLoading('search')
    await doSearch()
    setLoading('')
  }

  const answer = async () => {
    if (!body.trim() || loading) return
    setError(null)
    setLoading('answer')
    const r = await doSearch()
    if (r) {
      const context = r.map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${x.snippet}`).join('\n\n')
      const sys =
        'Ты отвечаешь на вопрос пользователя, опираясь на результаты веб-поиска ниже. ' +
        'Дай точный ответ на русском в Markdown, ссылайся на источники как [1], [2]. ' +
        'Если данных недостаточно — честно скажи.'
      const prompt = `Вопрос: ${body}\n\nРезультаты поиска:\n${context}`
      const air = await window.flow.aiChat({
        model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: prompt }
        ]
      })
      if (air.ok) ensureResultCard(editor, shape.id, air.content)
      else setError(air.error)
    }
    setLoading('')
  }

  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}
    >
      <ModelSelect value={model} onChange={(v) => update({ model: v })} />
      <textarea
        className="flow-input"
        value={body}
        onChange={(e) => update({ body: e.currentTarget.value })}
        placeholder="Что найти?"
        style={{ ...fieldStyle, minHeight: 38, maxHeight: 60, resize: 'none', lineHeight: 1.4 }}
      />
      <MicButton
        onText={(t) => {
          const cur = ((editor.getShape(shape.id) as FlowNodeShape | undefined)?.props.body as string) || ''
          update({ body: cur ? cur.replace(/\s*$/, '') + ' ' + t : t })
        }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className="flow-run-btn"
          onClick={search}
          disabled={!!loading}
          style={{
            flex: 1,
            cursor: loading ? 'default' : 'pointer',
            border: 'none',
            borderRadius: 10,
            padding: '8px',
            fontSize: 12.5,
            fontWeight: 600,
            color: '#fff',
            background: loading === 'search' ? '#3a3a3c' : 'linear-gradient(180deg,#5ac8fa,#32ade6)',
            boxShadow: '0 2px 8px rgba(50,173,230,0.3)'
          }}
        >
          {loading === 'search' ? '🔎 Ищу…' : '🔎 Найти'}
        </button>
        <button
          className="flow-run-btn"
          onClick={answer}
          disabled={!!loading}
          style={{
            flex: 1.3,
            cursor: loading ? 'default' : 'pointer',
            border: 'none',
            borderRadius: 10,
            padding: '8px',
            fontSize: 12.5,
            fontWeight: 600,
            color: '#fff',
            background: loading === 'answer' ? '#3a3a3c' : 'linear-gradient(180deg,#409cff,#0a84ff)',
            boxShadow: '0 2px 8px rgba(10,132,255,0.3)'
          }}
        >
          {loading === 'answer' ? '🤖 Думаю…' : '🤖 Ответить'}
        </button>
      </div>

      {/* Научный поиск: статьи из журналов (OpenAlex + Elsevier) → PDF-нода с RAG */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          onClick={searchPapers}
          disabled={sciLoading}
          title="Искать научные статьи (arXiv/PubMed/журналы через OpenAlex + Elsevier)"
          style={{
            flex: 1,
            cursor: sciLoading ? 'default' : 'pointer',
            border: '1px solid #A78BFA',
            borderRadius: 10,
            padding: '7px',
            fontSize: 12,
            fontWeight: 600,
            color: sciLoading ? C.textDim : '#c4b5fd',
            background: 'rgba(167,139,250,0.10)'
          }}
        >
          {sciLoading ? '🔬 Ищу статьи…' : '🔬 Научные статьи'}
        </button>
        <label
          title="Добавить Elsevier как источник поиска (нужно право ScienceDirect Search у ключа; иначе поиск через OpenAlex, а полный текст всё равно качается по DOI)"
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: C.textDim, cursor: 'pointer', flexShrink: 0 }}
        >
          <input type="checkbox" checked={useElsevier} onChange={(e) => setUseElsevier(e.currentTarget.checked)} />
          + Elsevier
        </label>
      </div>

      {error && <div style={{ fontSize: 11, color: C.red, whiteSpace: 'pre-wrap' }}>{error}</div>}
      {sciNote && <div style={{ fontSize: 10.5, color: '#FBBF24', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>⚠ {sciNote}</div>}

      {papers.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={downloadAll}
            disabled={!!dl || kbBusy}
            title="Скачать все найденные статьи (до 15) на доску отдельными PDF-нодами"
            style={{
              flex: 1,
              border: `1px solid #A78BFA`,
              background: 'rgba(167,139,250,0.12)',
              color: dl || kbBusy ? C.textDim : '#c4b5fd',
              borderRadius: 8,
              padding: '6px',
              fontSize: 12,
              fontWeight: 600,
              cursor: dl || kbBusy ? 'default' : 'pointer'
            }}
          >
            {dl.startsWith('all:') ? '⬇ Скачиваю…' : `⬇ Все на доску (${Math.min(15, papers.length)})`}
          </button>
          <button
            onClick={downloadAllToKb}
            disabled={!!dl || kbBusy}
            title="Скачать все найденные статьи и залить в базу знаний AnythingLLM (нужен его API-ключ)"
            style={{
              flex: 1,
              border: `1px solid #14B8A6`,
              background: 'rgba(20,184,166,0.12)',
              color: dl || kbBusy ? C.textDim : '#2dd4bf',
              borderRadius: 8,
              padding: '6px',
              fontSize: 12,
              fontWeight: 600,
              cursor: dl || kbBusy ? 'default' : 'pointer'
            }}
          >
            {kbBusy ? '📚 Заливаю…' : '📚 В AnythingLLM'}
          </button>
        </div>
      )}
      {kbMsg && <div style={{ fontSize: 10.5, color: '#2dd4bf', lineHeight: 1.4 }}>{kbMsg}</div>}

      {papers.length > 0 && (
        <div className="flow-scroll" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 9 }}>
          {papers.map((p) => (
            <div key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: 8 }}>
              <div style={{ display: 'flex', gap: 5, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 2 }}>
                {p.oa ? (
                  <span style={{ fontSize: 8.5, fontWeight: 700, color: '#4ADE80', border: '1px solid rgba(74,222,128,0.4)', borderRadius: 4, padding: '0 4px' }}>OA</span>
                ) : (
                  <span style={{ fontSize: 8.5, fontWeight: 700, color: '#FBBF24', border: '1px solid rgba(251,191,36,0.4)', borderRadius: 4, padding: '0 4px' }}>🔒</span>
                )}
                <span style={{ fontSize: 8.5, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 4, padding: '0 4px' }}>{p.source}</span>
                {p.year ? <span style={{ fontSize: 10, color: C.textDim }}>{p.year}</span> : null}
              </div>
              <a
                onClick={() => p.url && window.flow.openExternal({ url: p.url })}
                style={{ color: '#c4b5fd', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', display: 'block', lineHeight: 1.35 }}
              >
                {p.title}
              </a>
              <div style={{ fontSize: 10, color: C.textDim, marginTop: 1 }}>
                {p.authors.slice(0, 3).join(', ')}
                {p.authors.length > 3 ? ' и др.' : ''}
                {p.venue ? ` · ${p.venue}` : ''}
              </div>
              {p.abstract && (
                <div style={{ fontSize: 10.5, color: C.textDim, lineHeight: 1.4, marginTop: 3, maxHeight: 54, overflow: 'hidden' }}>
                  {p.abstract}
                </div>
              )}
              <button
                onClick={() => downloadPaper(p)}
                disabled={!!dl}
                title="Скачать PDF и создать PDF-ноду (с RAG и Q&A)"
                style={{
                  marginTop: 5,
                  border: `1px solid ${C.border}`,
                  background: C.field,
                  color: dl === p.id ? C.textDim : '#c4b5fd',
                  borderRadius: 7,
                  padding: '3px 9px',
                  fontSize: 11,
                  cursor: dl ? 'default' : 'pointer'
                }}
              >
                {dl === p.id ? '⬇ Скачиваю…' : '⬇ PDF на холст'}
              </button>
            </div>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <div
          className="flow-scroll"
          style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {results.map((r, i) => (
            <div key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: 6 }}>
              <a
                onClick={() => window.flow.openExternal({ url: r.url })}
                style={{
                  color: '#5ac8fa',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'block',
                  lineHeight: 1.35
                }}
              >
                {r.title}
              </a>
              <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.4, marginTop: 2 }}>
                {r.snippet}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Нода-референс (загрузка фото, присоединяется стрелкой) ----------
function RefBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  let image = ''
  try {
    image = JSON.parse(shape.props.extra || '{}').image || ''
  } catch {
    /* ignore */
  }
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div
      onPointerDown={stopEventPropagation}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}
    >
      <div
        style={{
          flex: 1,
          borderRadius: 8,
          overflow: 'hidden',
          background: '#171a20',
          border: `1px solid ${C.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {image ? (
          <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 12, color: C.textDim }}>Нет фото</span>
        )}
      </div>
      <button
        className="flow-run-btn"
        onClick={() => fileRef.current?.click()}
        style={{
          border: 'none',
          borderRadius: 10,
          padding: '8px',
          fontSize: 12.5,
          fontWeight: 600,
          color: '#00303f',
          background: 'linear-gradient(180deg,#8ee0ff,#64d2ff)',
          cursor: 'pointer'
        }}
      >
        📁 Загрузить фото
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0]
          if (!f) return
          const r = new FileReader()
          r.onload = () => update({ extra: JSON.stringify({ image: String(r.result) }) })
          r.readAsDataURL(f)
        }}
      />
    </div>
  )
}

// ---------- Тело картинка-ноды (генерация через ComfyUI) ----------
function ImageBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  const { body } = shape.props // body = промпт
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ex: any = {}
  try {
    ex = JSON.parse(shape.props.extra || '{}')
  } catch {
    /* ignore */
  }
  const checkpoint: string = ex.checkpoint || ''
  const negative: string = ex.negative || ''
  const size: string = ex.size || 'Квадрат 1024'
  const steps: number = ex.steps || 20
  const modelType: string = ex.modelType || 'flux'
  const setEx = (patch: Record<string, unknown>) =>
    update({ extra: JSON.stringify({ ...ex, ...patch }) })

  const [checkpoints, setCheckpoints] = useState<string[]>([])
  const [unets, setUnets] = useState<string[]>([])
  const [ckptError, setCkptError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Превратить идею (на любом языке) в детальный английский промпт для FLUX
  const enhance = async () => {
    if (!body.trim() || enhancing) return
    setEnhancing(true)
    try {
      const sys =
        'Ты составляешь промпты для генератора изображений FLUX. По идее пользователя (на любом языке) верни ОДИН детальный промпт НА АНГЛИЙСКОМ: объекты, стиль, композиция, свет, качество. Только сам промпт, без пояснений и кавычек.'
      const res = await window.flow.aiChat({
        model: '',
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: body }
        ]
      })
      if (res.ok) update({ body: res.content.trim() })
      else setError(res.error)
    } catch (e) {
      setError(String(e))
    } finally {
      setEnhancing(false)
    }
  }

  useEffect(() => {
    window.flow?.comfyModels().then((r) => {
      if (r.ok) {
        setCheckpoints(r.checkpoints)
        setUnets(r.unets)
      } else {
        setCkptError(r.error)
      }
    })
  }, [])

  // Для FLUX модель берётся из models/unet, для SDXL — из checkpoints
  const modelList = modelType === 'flux' ? unets : checkpoints

  const generate = async () => {
    if (!body.trim() || loading) return
    setError(null)
    setLoading(true)
    try {
      const [w, h] = IMAGE_SIZES[size] ?? [1024, 1024]
      const res = await window.flow.comfyGenerate({
        checkpoint: checkpoint || modelList[0] || '',
        prompt: body,
        negative,
        width: w,
        height: h,
        steps,
        modelType
      })
      if (res.ok) ensureResultCard(editor, shape.id, `🖼 ${body}`, [res.image])
      else setError(res.error)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}
    >
      {/* Модель (чекпоинт) + тип */}
      <div style={{ display: 'flex', gap: 6 }}>
        <select
          className="flow-input"
          value={checkpoint}
          onChange={(e) => setEx({ checkpoint: e.currentTarget.value })}
          style={{ ...selectStyle, flex: 1 }}
        >
          <option value="">
            {modelList.length
              ? 'Модель по умолчанию'
              : modelType === 'flux'
                ? 'Нет FLUX — положи модель в models/unet'
                : 'Нет моделей — запусти ComfyUI'}
          </option>
          {modelList.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className="flow-input"
          value={modelType}
          onChange={(e) => setEx({ modelType: e.currentTarget.value })}
          title="Тип модели"
          style={{ ...selectStyle, width: 92 }}
        >
          <option value="flux">FLUX</option>
          <option value="sdxl">SDXL</option>
        </select>
      </div>

      {/* Промпт */}
      <textarea
        className="flow-input flow-scroll"
        value={body}
        onChange={(e) => update({ body: e.currentTarget.value })}
        placeholder="Опиши картинку (можно по-русски → нажми «Улучшить»)"
        style={{ ...fieldStyle, flex: 1, minHeight: 50, resize: 'none', lineHeight: 1.4 }}
      />
      <button
        className="flow-run-btn"
        onClick={enhance}
        disabled={enhancing}
        style={{
          cursor: enhancing ? 'default' : 'pointer',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 10,
          padding: '7px',
          fontSize: 12,
          fontWeight: 600,
          color: '#e6e6e6',
          background: enhancing ? '#3a3a3c' : '#2f333d'
        }}
      >
        {enhancing ? '🤖 Улучшаю…' : '🤖 Улучшить промпт (в английский)'}
      </button>

      {/* Негатив + размер + шаги */}
      <input
        className="flow-input"
        value={negative}
        onChange={(e) => setEx({ negative: e.currentTarget.value })}
        placeholder="Что исключить (negative)"
        style={fieldStyle}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <select
          className="flow-input"
          value={size}
          onChange={(e) => setEx({ size: e.currentTarget.value })}
          style={{ ...selectStyle, flex: 1 }}
        >
          {Object.keys(IMAGE_SIZES).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          className="flow-input"
          type="number"
          min={1}
          max={60}
          value={steps}
          onChange={(e) => setEx({ steps: Number(e.currentTarget.value) || 20 })}
          title="Шагов"
          style={{ ...fieldStyle, width: 64 }}
        />
      </div>

      <button
        className="flow-run-btn"
        onClick={generate}
        disabled={loading}
        style={{
          cursor: loading ? 'default' : 'pointer',
          border: 'none',
          borderRadius: 10,
          padding: '9px',
          fontSize: 13,
          fontWeight: 600,
          color: '#fff',
          background: loading ? '#3a3a3c' : 'linear-gradient(180deg,#ff6482,#ff375f)',
          boxShadow: loading ? 'none' : '0 2px 8px rgba(255,55,95,0.35)',
          transition: 'filter .15s, transform .05s'
        }}
      >
        {loading ? '🎨 Рисую…' : '🎨 Сгенерировать'}
      </button>

      {ckptError && !checkpoints.length && (
        <div style={{ fontSize: 11, color: C.textDim }}>{ckptError}</div>
      )}
      {error && <div style={{ fontSize: 11, color: C.red, whiteSpace: 'pre-wrap' }}>{error}</div>}
    </div>
  )
}

// Разобрать JSON-структуру презентации из ответа модели
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseDeckJSON(text: string): any {
  try {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    const j = JSON.parse(m[0])
    if (!Array.isArray(j.slides)) return null
    return j
  } catch {
    return null
  }
}

// Создать карточки-слайды (каждый — HTML) в ряд справа от ноды-презентации
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createSlideNodes(editor: Editor, deckId: string, deck: any): string[] {
  const bounds = editor.getShapePageBounds(deckId as never)
  if (!bounds) return []
  const W = 560
  const H = 315
  const GAP = 44
  const startX = bounds.maxX + 80
  const startY = bounds.y
  const ids: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deck.slides.forEach((slide: any, i: number) => {
    const id = createShapeId()
    editor.createShape<FlowNodeShape>({
      id,
      type: 'flow-node',
      x: startX + i * (W + GAP),
      y: startY,
      props: { kind: 'slide', title: '', body: JSON.stringify(slide), w: W, h: H, extra: '{}' }
    })
    ids.push(id)
  })
  return ids
}

// Сгенерировать/обновить картинку конкретного слайда через FLUX
async function generateSlideImage(
  editor: Editor,
  slideId: string,
  promptOverride?: string
): Promise<{ ok: boolean; error?: string }> {
  const sh = editor.getShape<FlowNodeShape>(slideId as never)
  if (!sh) return { ok: false, error: 'нет слайда' }
  const slide = parseSlide(sh.props.body)
  const prompt = promptOverride || slide.imagePrompt || slide.title || 'abstract background'
  const models = await window.flow.comfyModels()
  const flux = models.ok ? models.unets.find((u) => /flux/i.test(u)) : undefined
  if (!flux) return { ok: false, error: 'FLUX не найден — запусти ComfyUI' }
  const r = await window.flow.comfyGenerate({
    checkpoint: flux,
    prompt,
    negative: '',
    width: 1216,
    height: 832,
    steps: 20,
    modelType: 'flux'
  })
  if (!r.ok) return { ok: false, error: r.error }
  const fresh = editor.getShape<FlowNodeShape>(slideId as never)
  let ex = {}
  try {
    ex = JSON.parse(fresh?.props.extra || '{}')
  } catch {
    /* ignore */
  }
  editor.updateShape<FlowNodeShape>({
    id: slideId as never,
    type: 'flow-node',
    props: { extra: JSON.stringify({ ...ex, image: r.image }) }
  })
  return { ok: true }
}

const exportBtnStyle = {
  flex: 1,
  cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10,
  padding: '7px',
  fontSize: 12,
  fontWeight: 600,
  color: '#e6e6e6',
  background: '#2f333d'
} as const

// Применить цветовую палитру ко всем слайдам презентации
function applyPaletteToSlides(editor: Editor, ids: string[], pal: Palette) {
  ids.forEach((id) => {
    const sh = editor.getShape<FlowNodeShape>(id as never)
    if (!sh) return
    const sl = parseSlide(sh.props.body)
    const next = { ...sl, accent: pal.accent, accent2: pal.accent2, bg: pal.bg }
    editor.updateShape<FlowNodeShape>({ id: id as never, type: 'flow-node', props: { body: JSON.stringify(next) } })
  })
}

// ---------- Нода-презентация (дизайнерские HTML-слайды + экспорт) ----------
function DeckBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  const { body, model } = shape.props
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ex: any = {}
  try {
    ex = JSON.parse(shape.props.extra || '{}')
  } catch {
    /* ignore */
  }
  const count: number = ex.count || 6
  const withImages: boolean = !!ex.withImages
  const palId: string = ex.palette || 'night'
  const customAccent: string = ex.customAccent || '#4c8dff'
  const getPalette = (): Palette =>
    palId === 'custom' ? customPalette(customAccent) : PALETTES.find((p) => p.id === palId) || PALETTES[0]
  const setEx = (p: Record<string, unknown>) => update({ extra: JSON.stringify({ ...ex, ...p }) })

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const layoutRef: string | undefined = ex.layoutRef

  // Снять выделение с холста как PNG-макет — ИИ построит презентацию по нему
  const captureLayout = async () => {
    const ids = editor.getSelectedShapeIds().filter((id) => id !== shape.id)
    if (!ids.length) {
      setError('Выдели на холсте фигуры/рамку-макет (инструменты снизу), затем нажми снова')
      return
    }
    setError(null)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out = await (editor as any).toImage(ids, { format: 'png', background: true, scale: 1, padding: 16 })
      const blob: Blob = out.blob
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = reject
        r.readAsDataURL(blob)
      })
      setEx({ layoutRef: dataUrl })
      setStatus('Макет с холста прикреплён ✅')
    } catch (e) {
      setError('Не удалось снять макет: ' + String(e))
    }
  }

  const generate = async () => {
    if (!body.trim() || busy) return
    setError(null)
    setBusy(true)
    setStatus('🤖 Проектирую слайды…')
    try {
      const refs = gatherReferences(editor, shape.id)
      let userContent = body
      if (refs.texts.length) userContent += '\n\nРеференсы (материалы):\n' + refs.texts.join('\n')
      const allImages = [...(layoutRef ? [layoutRef] : []), ...refs.images]
      const sys =
        SLIDE_SYSTEM_PROMPT +
        (allImages.length
          ? '\nУчитывай приложенные изображения-референсы (стиль, объекты, цвета, композиция).'
          : '') +
        (layoutRef
          ? '\nПЕРВОЕ изображение — МАКЕТ/каркас будущей презентации: следуй его композиции, расположению блоков и структуре слайдов.'
          : '') +
        `\nКоличество слайдов: ${count}.`
      if (allImages.length || refs.texts.length) setStatus('🔗 Учитываю референсы…')
      const res = await window.flow.aiChat({
        model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userContent }
        ],
        images: allImages.length ? allImages : undefined
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      const deck = parseDeckJSON(res.content)
      if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) {
        setError('Не удалось разобрать слайды. Попробуй ещё раз или другую модель.')
        return
      }
      const ids = createSlideNodes(editor, shape.id, deck)
      // Если пользователь сам не выбрал палитру — берём случайную, чтобы разные
      // презентации отличались по цвету, а не были все синими.
      const pal = ex.paletteSet ? getPalette() : PALETTES[Math.floor(Math.random() * PALETTES.length)]
      applyPaletteToSlides(editor, ids, pal)
      setEx({ slideIds: ids, deckTitle: deck.title || 'Презентация', palette: pal.id })
      if (withImages) {
        for (let i = 0; i < ids.length; i++) {
          const sl = parseSlide(editor.getShape<FlowNodeShape>(ids[i] as never)?.props.body || '{}')
          if (!sl.imagePrompt) continue
          setStatus(`🎨 Фото ${i + 1}/${ids.length}…`)
          await generateSlideImage(editor, ids[i])
        }
      }
      setStatus(`Готово: ${ids.length} слайдов ✅`)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const collectSlides = (): ExportItem[] => {
    const ids: string[] = ex.slideIds || []
    return ids
      .map((id) => {
        const s = editor.getShape<FlowNodeShape>(id as never)
        if (!s) return null
        let image = ''
        try {
          image = JSON.parse(s.props.extra || '{}').image || ''
        } catch {
          /* ignore */
        }
        return { slide: parseSlide(s.props.body), image }
      })
      .filter((x): x is ExportItem => !!x)
  }

  const doExport = async (kind: 'pdf' | 'pptx') => {
    const items = collectSlides()
    if (!items.length) {
      setError('Сначала сгенерируй презентацию')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const pngs = await slidesToPngs(items, (i, n) => setStatus(`Рендер ${i}/${n}…`))
      if (kind === 'pdf') await exportPdf(ex.deckTitle || 'presentation', pngs)
      else await exportPptx(ex.deckTitle || 'presentation', pngs)
      setStatus('Экспортировано ✅')
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const hasSlides = (ex.slideIds || []).length > 0

  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}
    >
      <ModelSelect value={model} onChange={(v) => update({ model: v })} />
      <textarea
        className="flow-input flow-scroll"
        value={body}
        onChange={(e) => update({ body: e.currentTarget.value })}
        placeholder="Тема презентации (напр. «MVP-проект по бетону»)"
        style={{ ...fieldStyle, flex: 1, minHeight: 46, resize: 'none', lineHeight: 1.4 }}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 11.5, color: C.textDim }}>Слайдов:</span>
        <input
          className="flow-input"
          type="number"
          min={1}
          max={20}
          value={count}
          onChange={(e) => setEx({ count: Number(e.currentTarget.value) || 6 })}
          style={{ ...fieldStyle, width: 56 }}
        />
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: C.textDim, cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            checked={withImages}
            onChange={() => setEx({ withImages: !withImages })}
            style={{ width: 14, height: 14, accentColor: C.blue }}
          />
          🎨 фото сразу
        </label>
      </div>

      {/* Цветовая гамма презентации */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11.5, color: C.textDim }}>Цветовая гамма</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {PALETTES.map((p) => (
            <button
              key={p.id}
              title={p.name}
              onClick={() => {
                setEx({ palette: p.id, paletteSet: true })
                // Сразу перекрашиваем уже созданные слайды — иначе выбор «не работает»
                if (ex.slideIds?.length) {
                  applyPaletteToSlides(editor, ex.slideIds, p)
                  setStatus(`Палитра «${p.name}» применена`)
                }
              }}
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                cursor: 'pointer',
                background: `linear-gradient(135deg, ${p.accent}, ${p.accent2})`,
                border: palId === p.id ? `2px solid ${C.text}` : `1px solid ${C.border}`
              }}
            />
          ))}
          <input
            type="color"
            title="Свой цвет"
            value={customAccent}
            onChange={(e) => {
              const val = e.currentTarget.value
              setEx({ palette: 'custom', customAccent: val, paletteSet: true })
              if (ex.slideIds?.length) applyPaletteToSlides(editor, ex.slideIds, customPalette(val))
            }}
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              border: palId === 'custom' ? `2px solid ${C.text}` : `1px solid ${C.border}`,
              background: 'none',
              cursor: 'pointer',
              padding: 0
            }}
          />
          {hasSlides && (
            <button
              onClick={() => {
                applyPaletteToSlides(editor, ex.slideIds || [], getPalette())
                setStatus('Палитра применена ко всем слайдам')
              }}
              style={{
                marginLeft: 'auto',
                border: `1px solid ${C.border}`,
                background: 'rgba(255,255,255,0.05)',
                color: C.textDim,
                borderRadius: 7,
                fontSize: 11,
                padding: '4px 8px',
                cursor: 'pointer'
              }}
            >
              Ко всем
            </button>
          )}
        </div>
      </div>

      {/* Макет с холста → ИИ построит презентацию по нему */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="flow-run-btn" onClick={captureLayout} style={{ ...exportBtnStyle, flex: 'none', padding: '7px 10px' }}>
          📐 Макет с холста
        </button>
        {layoutRef ? (
          <span style={{ fontSize: 11, color: C.textDim, display: 'flex', alignItems: 'center', gap: 6 }}>
            <img src={layoutRef} alt="" style={{ width: 26, height: 18, objectFit: 'cover', borderRadius: 3, border: `1px solid ${C.border}` }} />
            прикреплён
            <span onClick={() => setEx({ layoutRef: undefined })} style={{ cursor: 'pointer', color: C.blue }}>
              сброс
            </span>
          </span>
        ) : (
          <span style={{ fontSize: 10.5, color: C.textDim }}>выдели фигуры на холсте</span>
        )}
      </div>

      <button
        className="flow-run-btn"
        onClick={generate}
        disabled={busy}
        style={{
          cursor: busy ? 'default' : 'pointer',
          border: 'none',
          borderRadius: 10,
          padding: '9px',
          fontSize: 13,
          fontWeight: 600,
          color: '#fff',
          background: busy ? '#3a3a3c' : 'linear-gradient(180deg,#ffb340,#ff9500)',
          boxShadow: busy ? 'none' : '0 2px 8px rgba(255,149,0,0.35)'
        }}
      >
        {busy ? '⏳ Работаю…' : '🎞 Сгенерировать презентацию'}
      </button>
      {hasSlides && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="flow-run-btn" onClick={() => doExport('pdf')} disabled={busy} style={exportBtnStyle}>
            ⬇ PDF
          </button>
          <button className="flow-run-btn" onClick={() => doExport('pptx')} disabled={busy} style={exportBtnStyle}>
            ⬇ PPTX
          </button>
        </div>
      )}
      {status && <div style={{ fontSize: 11, color: C.textDim }}>{status}</div>}
      {error && <div style={{ fontSize: 11, color: C.red, whiteSpace: 'pre-wrap' }}>{error}</div>}
    </div>
  )
}

const slideToolBtn = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(18,21,28,0.82)',
  color: '#fff',
  fontSize: 14,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
} as const

// ---------- Карточка-слайд (шаблон-дизайн + панель ✏️/🎨) ----------
function SlideCard({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const { body, w, h } = shape.props
  const slide = parseSlide(body)
  let image = ''
  try {
    image = JSON.parse(shape.props.extra || '{}').image || ''
  } catch {
    /* ignore */
  }
  const [hover, setHover] = useState(false)
  const [imgBusy, setImgBusy] = useState(false)

  const genImg = async () => {
    if (imgBusy) return
    setImgBusy(true)
    await generateSlideImage(editor, shape.id)
    setImgBusy(false)
  }
  const editSlide = () =>
    window.dispatchEvent(new CustomEvent('flow-edit-slide', { detail: shape.id }))

  return (
    <HTMLContainer
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: w,
        height: h,
        borderRadius: 12,
        overflow: 'hidden',
        background: '#12151c',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 10px 34px rgba(0,0,0,0.45)',
        pointerEvents: 'all',
        position: 'relative'
      }}
    >
      <ScaledSlide slide={slide} image={image} width={w} />
      {hover && (
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6, zIndex: 5 }}>
          <button
            onPointerDown={stopEventPropagation}
            onClick={() => window.dispatchEvent(new CustomEvent('flow-fullscreen-node', { detail: String(shape.id) }))}
            title="На весь экран"
            style={{ ...slideToolBtn, cursor: 'pointer' }}
          >
            ⛶
          </button>
          <button
            onPointerDown={stopEventPropagation}
            onClick={editSlide}
            title="Редактировать слайд"
            style={{ ...slideToolBtn, cursor: 'pointer' }}
          >
            ✏️
          </button>
          <button
            onPointerDown={stopEventPropagation}
            onClick={genImg}
            disabled={imgBusy}
            title="Сгенерировать фото (FLUX)"
            style={{ ...slideToolBtn, cursor: imgBusy ? 'default' : 'pointer' }}
          >
            {imgBusy ? '⏳' : '🎨'}
          </button>
        </div>
      )}
    </HTMLContainer>
  )
}

// ---------- Разбор Mermaid-flowchart в редактируемые фигуры холста ----------
type FlowParsed = { nodes: string[]; labels: Map<string, string>; edges: { from: string; to: string; label?: string }[] }

// Токен ноды: id + скобки-форма + текст (A[..], B(..), C{..}, ((..)), [[..]], >..])
const NODE_RE = /([A-Za-z0-9_]+)\s*(\[\[|\(\(|\{\{|\[|\(|\{|>)([^\]\)\}]*?)(\]\]|\)\)|\}\}|\]|\)|\})/g
// Оператор-связь: run из - . = < > x o (минимум 2 «телесных» символа)
const EDGE_SPLIT = /\s*[<xo]?[-.=]{2,}[>xo]?\s*/

function parseFlowchart(code: string): FlowParsed {
  const labels = new Map<string, string>()
  const order: string[] = []
  const edges: { from: string; to: string; label?: string }[] = []
  const ensure = (id: string) => {
    if (!labels.has(id)) {
      labels.set(id, id)
      order.push(id)
    }
  }
  const stmts = code
    .replace(/\r/g, '')
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  for (const raw of stmts) {
    if (/^(flowchart|graph|subgraph|end|classDef|class|style|linkStyle|click|direction|%%)/i.test(raw)) continue
    // Явные подписи нод
    let m: RegExpExecArray | null
    NODE_RE.lastIndex = 0
    while ((m = NODE_RE.exec(raw))) {
      ensure(m[1])
      labels.set(m[1], (m[3] || m[1]).trim() || m[1])
    }
    // Убираем скобки-подписи, чтобы остались только id и операторы
    const stripped = raw.replace(NODE_RE, '$1')
    // Достаём подписи связей: |текст| и -- текст -->
    const edgeLabels: string[] = []
    let s2 = stripped.replace(/\|([^|]*)\|/g, (_x, l) => {
      edgeLabels.push(String(l).trim())
      return ' '
    })
    s2 = s2.replace(/--\s*([^->\n]+?)\s*--?>/g, (_x, l) => {
      edgeLabels.push(String(l).trim())
      return ' --> '
    })
    const ids = s2
      .split(EDGE_SPLIT)
      .map((x) => x.trim())
      .filter((x) => /^[A-Za-z0-9_]+$/.test(x))
    ids.forEach(ensure)
    for (let i = 0; i < ids.length - 1; i++) {
      edges.push({ from: ids[i], to: ids[i + 1], label: edgeLabels[i] || undefined })
    }
  }
  return { nodes: order, labels, edges }
}

function clampN(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

// Простая слоёная раскладка (по направлению) → координаты боксов
function layoutFlow(p: FlowParsed, dir: string, ox: number, oy: number) {
  const rank = new Map<string, number>()
  p.nodes.forEach((n) => rank.set(n, 0))
  for (let pass = 0; pass < p.nodes.length + 1; pass++) {
    let changed = false
    for (const e of p.edges) {
      if (rank.has(e.from) && rank.has(e.to)) {
        const nr = (rank.get(e.from) as number) + 1
        if (nr > (rank.get(e.to) as number)) {
          rank.set(e.to, nr)
          changed = true
        }
      }
    }
    if (!changed) break
  }
  const byRank = new Map<number, string[]>()
  p.nodes.forEach((n) => {
    const r = rank.get(n) || 0
    if (!byRank.has(r)) byRank.set(r, [])
    ;(byRank.get(r) as string[]).push(n)
  })
  const horizontal = /LR|RL/i.test(dir)
  const boxH = 66
  const wOf = (id: string) => clampN((p.labels.get(id) || id).length * 10 + 44, 120, 300)
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>()
  const layerGap = horizontal ? 300 : 150
  const crossGap = horizontal ? 110 : 240
  Array.from(byRank.keys())
    .sort((a, b) => a - b)
    .forEach((r) => {
      const list = byRank.get(r) as string[]
      list.forEach((id, i) => {
        const along = r * layerGap
        const cross = i * crossGap
        const x = horizontal ? ox + along : ox + cross
        const y = horizontal ? oy + cross : oy + along
        pos.set(id, { x, y, w: wOf(id), h: boxH })
      })
    })
  return pos
}

// Разобрать текущий Mermaid-код в фигуры холста (редактируются нативно).
// Возвращает число созданных боксов.
function mermaidToShapes(editor: Editor, code: string, ox: number, oy: number): number {
  const dirM = code.match(/(?:flowchart|graph)\s+(TB|TD|BT|RL|LR)/i)
  const dir = dirM ? dirM[1] : 'TB'
  const parsed = parseFlowchart(code)
  if (!parsed.nodes.length) return 0
  const pos = layoutFlow(parsed, dir, ox, oy)
  const idMap = new Map<string, string>()
  const created: string[] = []
  // Боксы
  parsed.nodes.forEach((n) => {
    const box = pos.get(n)
    if (!box) return
    const shId = createShapeId()
    idMap.set(n, shId)
    created.push(shId)
    editor.createShape({
      id: shId as never,
      type: 'geo',
      x: box.x,
      y: box.y,
      props: {
        geo: 'rectangle',
        w: box.w,
        h: box.h,
        color: 'blue',
        fill: 'semi',
        richText: toRichText(parsed.labels.get(n) || n)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
  })
  // Стрелки
  parsed.edges.forEach((e) => {
    const from = idMap.get(e.from)
    const to = idMap.get(e.to)
    if (!from || !to) return
    const aId = createShapeId()
    created.push(aId)
    editor.createShape({
      id: aId as never,
      type: 'arrow',
      props: { color: 'grey', size: 'm', ...(e.label ? { richText: toRichText(e.label) } : {}) }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    editor.createBinding({
      fromId: aId,
      toId: from,
      type: 'arrow',
      props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }
    } as never)
    editor.createBinding({
      fromId: aId,
      toId: to,
      type: 'arrow',
      props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }
    } as never)
  })
  try {
    editor.setSelectedShapes(created as never)
  } catch {
    /* не критично */
  }
  return parsed.nodes.length
}

// ---------- Нода-схема (Mermaid: описание → диаграмма, живой предпросмотр) ----------
function DiagramBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  const { body, model } = shape.props // body = исходник Mermaid
  const instruction = parseExtra(shape.props.extra).instruction ?? ''
  const setInstruction = (v: string) =>
    update({ extra: JSON.stringify({ ...parseExtra(shape.props.extra), instruction: v }) })
  const [gen, setGen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  // Живой предпросмотр — рисуем императивно через mermaid.render
  useEffect(() => {
    if (previewRef.current) {
      renderMermaidCode(previewRef.current, body?.trim() || 'graph TD; A[Опиши схему выше] --> B[и сгенерируй]')
    }
  }, [body])

  const generate = async () => {
    if (!instruction.trim() || gen) return
    setError(null)
    setGen(true)
    try {
      const sys =
        'Ты генерируешь диаграммы Mermaid. По описанию пользователя верни ТОЛЬКО валидный код Mermaid ' +
        '(flowchart TD/LR, sequenceDiagram, classDiagram, stateDiagram, erDiagram — выбери подходящий тип), ' +
        'без markdown-ограждений и без пояснений. Подписи узлов — на русском.'
      const res = await window.flow.aiChat({
        model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: instruction }
        ]
      })
      if (res.ok) update({ body: stripFences(res.content) })
      else setError(res.error)
    } catch (e) {
      setError(String(e))
    } finally {
      setGen(false)
    }
  }

  // Разобрать схему в редактируемые фигуры холста (боксы + стрелки)
  const toShapes = () => {
    setError(null)
    try {
      const b = editor.getShapePageBounds(shape.id as never)
      const ox = b ? b.maxX + 90 : 0
      const oy = b ? b.y : 0
      const n = mermaidToShapes(editor, body || '', ox, oy)
      if (!n) setError('Не удалось разобрать схему в блоки (поддерживается flowchart/graph)')
    } catch (e) {
      setError('Ошибка разбора: ' + String(e))
    }
  }

  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}
    >
      <ModelSelect value={model} onChange={(v) => update({ model: v })} />
      <textarea
        className="flow-input"
        value={instruction}
        onChange={(e) => setInstruction(e.currentTarget.value)}
        placeholder="Опиши схему (напр. «архитектура: клиент → API → база данных, кэш»)…"
        style={{ ...fieldStyle, minHeight: 42, maxHeight: 70, resize: 'none', lineHeight: 1.4 }}
      />
      <button
        className="flow-run-btn"
        onClick={generate}
        disabled={gen}
        style={{
          cursor: gen ? 'default' : 'pointer',
          border: 'none',
          borderRadius: 10,
          padding: '8px',
          fontSize: 12.5,
          fontWeight: 600,
          color: '#00303f',
          background: gen ? '#3a3a3c' : 'linear-gradient(180deg,#5ce1f5,#22D3EE)',
          boxShadow: gen ? 'none' : '0 2px 8px rgba(34,211,238,0.3)'
        }}
      >
        {gen ? '🤖 Проектирую…' : '◇ Сгенерировать схему'}
      </button>
      <textarea
        className="flow-input flow-scroll"
        value={body}
        spellCheck={false}
        onChange={(e) => update({ body: e.currentTarget.value })}
        placeholder={'graph TD;\n  A[Клиент] --> B[API];\n  B --> C[(База)]'}
        style={{
          ...fieldStyle,
          minHeight: 60,
          maxHeight: 120,
          resize: 'none',
          whiteSpace: 'pre',
          overflow: 'auto',
          fontFamily: 'Consolas, "Cascadia Mono", ui-monospace, monospace',
          fontSize: 12,
          lineHeight: 1.5
        }}
      />
      <button
        onClick={toShapes}
        title="Разобрать схему на редактируемые фигуры холста"
        style={{
          border: `1px solid ${C.border}`,
          background: 'rgba(255,255,255,0.05)',
          color: C.text,
          borderRadius: 10,
          padding: '8px',
          fontSize: 12.5,
          fontWeight: 600,
          cursor: 'pointer'
        }}
      >
        ✏️ Редактировать на холсте (блоки → тянуть за угол, правки текста)
      </button>
      <div
        ref={previewRef}
        className="flow-scroll"
        onWheelCapture={stopEventPropagation}
        style={{
          flex: 1,
          minHeight: 80,
          overflow: 'auto',
          background: C.field,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      />
      {error && <div style={{ fontSize: 11, color: C.red, whiteSpace: 'pre-wrap' }}>{error}</div>}
    </div>
  )
}

// ---------- Общий вид ноды ----------
// Сворачивание ноды хранится на время сессии (без изменения схемы shape)
const collapsedMap = new Map<string, boolean>()
const prevHMap = new Map<string, number>()
const HEADER_H = 39
const NODE_SANS = "'IBM Plex Sans', -apple-system, 'Segoe UI', system-ui, sans-serif"
const NODE_MONO = "'JetBrains Mono', monospace"
// Шрифт ДЛЯ ТЕРМИНАЛА xterm: системный моноширинный (есть сразу, без веб-загрузки).
// Веб-шрифт (JetBrains Mono) грузится асинхронно — xterm мерит ячейку до загрузки и
// сетка «плывёт». Consolas на Windows доступен мгновенно → измерение корректно.
const OC_TERM_FONT = "Consolas, 'Cascadia Mono', 'Courier New', monospace"

// Кружок-порт на краю ноды (как в макете): слева — нейтральный, справа — цвета типа
function PortDot({ side, color }: { side: 'left' | 'right'; color: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        [side]: -5,
        top: 16,
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: 'var(--panel)',
        border: `2px solid ${color}`,
        pointerEvents: 'none'
      }}
    />
  )
}

// Интерактивный «выход контекста»: потяни от него линию к другому чату,
// чтобы передать туда контекст этой ноды (создаётся стрелка-связь).
function ContextPort({
  editor,
  sourceId,
  color
}: {
  editor: Editor
  sourceId: string
  color: string
}) {
  const [drag, setDrag] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) =>
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d))
    const up = (e: PointerEvent) => {
      try {
        const pt = editor.screenToPage({ x: e.clientX, y: e.clientY })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const target = editor.getShapeAtPoint(pt, {
          hitInside: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          filter: (s: any) => s.type === 'flow-node' && s.id !== sourceId
        } as never)
        if (target && target.id !== sourceId) connectArrow(editor, sourceId, target.id as string)
      } catch {
        /* не критично */
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, editor, sourceId])

  return (
    <>
      <div
        title="Потяни к другому чату, чтобы передать ему контекст этой ноды"
        onPointerDown={(e) => {
          stopEventPropagation(e)
          e.preventDefault()
          setDrag({ x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY })
        }}
        style={{
          position: 'absolute',
          right: -7,
          top: 13,
          width: 15,
          height: 15,
          borderRadius: '50%',
          background: drag ? color : 'var(--panel)',
          border: `2px solid ${color}`,
          cursor: 'crosshair',
          pointerEvents: 'all',
          zIndex: 6,
          transition: 'background .1s'
        }}
      />
      {drag &&
        createPortal(
          <svg
            style={{
              position: 'fixed',
              inset: 0,
              width: '100vw',
              height: '100vh',
              pointerEvents: 'none',
              zIndex: 99999
            }}
          >
            <line
              x1={drag.x0}
              y1={drag.y0}
              x2={drag.x}
              y2={drag.y}
              stroke={color}
              strokeWidth={2.5}
              strokeDasharray="5 5"
            />
            <circle cx={drag.x} cy={drag.y} r={5} fill={color} />
          </svg>,
          document.body
        )}
    </>
  )
}

// ---------- OpenCode: настоящий терминал с TUI (PTY + xterm.js) ----------
// Нода поднимает реальный псевдотерминал в выбранной папке и запускает в нём
// `opencode` — тот же интерфейс, что в обычном терминале, включая его родной
// выбор модели (/models) и авторизацию по API-ключу (opencode auth login).
// Базовый кегль терминала (в CSS-пикселях при зуме холста = 1).
const OC_FONT_SIZE = 12
// tldraw держит ноду в масштабированном/дробно-сдвинутом слое, а DOM-рендерер xterm —
// растровый композитный слой, поэтому при зуме ≠ 1 (и даже из-за суб-пиксельного сдвига)
// он пересэмплируется и мылится. Лечим так: рендерим терминал во внутренней плотности m,
// совпадающей с экранным масштабом (ступени, чтобы не дёргать рендер на каждый тик зума),
// и ужимаем обратно scale(1/m). Сетка cols/rows не меняется — TUI не реформатируется.
const OC_DENSITY_LEVELS = [0.5, 0.75, 1, 1.5, 2, 3, 4]
const ocDensity = (z: number): number => OC_DENSITY_LEVELS.find((l) => l >= z) ?? 4
const OC_THEME = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor: '#fb923c',
  cursorAccent: '#0d1117',
  selectionBackground: 'rgba(251,146,60,0.35)',
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc'
}

// Маленькая кнопка тулбара терминала
function OcToolBtn({
  onClick,
  title,
  children,
  accent
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
  accent?: boolean
}) {
  return (
    <button
      onClick={onClick}
      onPointerDown={stopEventPropagation}
      title={title}
      style={{
        border: `1px solid ${accent ? '#fb923c' : C.border}`,
        background: accent ? 'rgba(251,146,60,0.15)' : '#0d1117',
        color: accent ? '#fb923c' : '#c9d1d9',
        borderRadius: 6,
        fontSize: 11,
        padding: '4px 8px',
        cursor: 'pointer',
        fontFamily: NODE_MONO,
        whiteSpace: 'nowrap'
      }}
    >
      {children}
    </button>
  )
}

// Запоминаем подобранную сетку терминала (cols/rows) по id ноды. Переживает
// культинг/ремаунт ноды — при возврате восстанавливаем ту же сетку, чтобы TUI не
// «съезжал» (иначе fit() на разном зуме даёт разный размер и буфер реплеится криво).
const ocTermSizes = new Map<string, { cols: number; rows: number }>()

function OpencodeBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  const ex = parseExtra(shape.props.extra) as { cwd?: string }
  const cwd = ex.cwd || ''
  const setEx = (patch: Record<string, unknown>) => update({ extra: JSON.stringify({ ...ex, ...patch }) })
  const id = String(shape.id)

  const wrapRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [alive, setAlive] = useState(false)

  // Плотность рендера терминала под текущий зум холста (см. ocDensity выше).
  const m = useValue('oc-density', () => ocDensity(editor.getZoomLevel()), [editor])

  // Создаём терминал, когда выбрана папка. Живёт, пока не сменят папку.
  useEffect(() => {
    if (!cwd || !wrapRef.current || !hostRef.current || termRef.current) return
    const m0 = ocDensity(editor.getZoomLevel())
    const term = new Terminal({
      fontFamily: OC_TERM_FONT,
      fontSize: OC_FONT_SIZE * m0, // рендерим в m0× плотности, наружу ужмём scale(1/m0)
      lineHeight: 1, // целочисленный — иначе строки в DOM-рендерере накапливают сдвиг
      theme: OC_THEME,
      cursorBlink: true,
      scrollback: 5000,
      convertEol: false
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    termRef.current = term
    fitRef.current = fit

    term.onData((d) => window.flow.ptyWrite({ id, data: d }))

    const offData = window.flow.onPtyData((msg) => {
      if (msg.id === id) term.write(msg.data)
    })
    const offExit = window.flow.onPtyExit((msg) => {
      if (msg.id === id) {
        setAlive(false)
        term.write('\r\n\x1b[38;2;251;146;60m[opencode завершён — нажми ⟳ чтобы перезапустить]\x1b[0m\r\n')
      }
    })

    const boot = requestAnimationFrame(() => {
      // Возврат ноды на экран → восстанавливаем прежнюю сетку (без пере-фита), иначе
      // фит на другом зуме даст другой размер и реплей буфера «поедет».
      const saved = ocTermSizes.get(id)
      if (saved) {
        try {
          term.resize(saved.cols, saved.rows)
        } catch {
          /* ignore */
        }
      } else {
        try {
          fit.fit()
        } catch {
          /* контейнер ещё без размера */
        }
        ocTermSizes.set(id, { cols: term.cols, rows: term.rows })
      }
      window.flow.ptyStart({ id, cwd, cols: term.cols, rows: term.rows, autostart: true }).then((r) => {
        if (r.ok) setAlive(true)
      })
    })

    // Рефитим ТОЛЬКО при реальном изменении логического размера ноды. contentRect
    // ResizeObserver — в CSS-пикселях, независимых от зума (в отличие от fit по DOM),
    // поэтому зум/ремаунт сетку не трогают, а ручной ресайз ноды — трогает.
    let lastW = Math.round(wrapRef.current.clientWidth)
    let lastH = Math.round(wrapRef.current.clientHeight)
    const ro = new ResizeObserver((entries) => {
      const t = termRef.current
      if (!t) return
      const cr = entries[0]?.contentRect
      if (!cr) return
      const w = Math.round(cr.width)
      const h = Math.round(cr.height)
      if (w === lastW && h === lastH) return // размер не менялся (напр. первый вызов после ремаунта)
      lastW = w
      lastH = h
      try {
        fit.fit()
        ocTermSizes.set(id, { cols: t.cols, rows: t.rows })
        window.flow.ptyResize({ id, cols: t.cols, rows: t.rows })
      } catch {
        /* ignore */
      }
    })
    ro.observe(wrapRef.current)

    return () => {
      cancelAnimationFrame(boot)
      offData()
      offExit()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      // pty НЕ убиваем: сессия должна пережить уход ноды за экран и вернуться.
    }
  }, [cwd, id])

  // Зум холста сменил «ступень» плотности → перерисовываем терминал крупнее/мельче.
  // Сетку cols/rows фиксируем (ресайзим к сохранённой), меняется только пиксельная
  // плотность ячейки — TUI не «съезжает», а картинка остаётся резкой.
  useEffect(() => {
    const t = termRef.current
    if (!t) return
    t.options.fontSize = OC_FONT_SIZE * m
    const saved = ocTermSizes.get(id)
    try {
      if (saved) t.resize(saved.cols, saved.rows)
      else fitRef.current?.fit()
    } catch {
      /* контейнер без размера */
    }
  }, [m, id])

  // Снимок терминала в реестр — чтобы связанный стрелкой ИИ-чат мог взять контекст.
  useEffect(() => {
    const iv = setInterval(() => {
      const term = termRef.current
      if (!term) return
      try {
        const buf = term.buffer.active
        const lines: string[] = []
        const start = Math.max(0, buf.length - 400)
        for (let i = start; i < buf.length; i++) {
          const line = buf.getLine(i)
          if (line) lines.push(line.translateToString(true))
        }
        setAgentTranscript(id, stripAnsi(lines.join('\n')))
      } catch {
        /* ignore */
      }
    }, 4000)
    return () => clearInterval(iv)
  }, [id])

  const pickFolder = async () => {
    const r = await window.flow.pickFolder()
    if (r.ok && r.path !== cwd) {
      window.flow.ptyKill({ id }) // сбросить старую сессию перед сменой папки
      setEx({ cwd: r.path })
    }
  }

  const restart = () => {
    window.flow.ptyKill({ id })
    const t = termRef.current
    if (!t) return
    t.reset()
    setTimeout(() => {
      const term = termRef.current
      if (!term) return
      try {
        fitRef.current?.fit()
        ocTermSizes.set(id, { cols: term.cols, rows: term.rows })
      } catch {
        /* ignore */
      }
      window.flow.ptyStart({ id, cwd, cols: term.cols, rows: term.rows, autostart: true }).then((rr) => {
        if (rr.ok) setAlive(true)
        term.focus()
      })
    }, 200)
  }

  const runCmd = (cmd: string) => {
    window.flow.ptyRun({ id, cmd, interrupt: true })
    termRef.current?.focus()
  }

  // Стартовый экран — пока не выбрана папка проекта
  if (!cwd) {
    return (
      <div
        onPointerDown={stopEventPropagation}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: NODE_MONO,
          color: C.textDim,
          textAlign: 'center',
          padding: 12
        }}
      >
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>
          <span style={{ color: '#fb923c' }}>opencode</span> запустится в выбранной папке —
          <br />
          настоящий терминал прямо в ноде.
        </div>
        <button
          onClick={pickFolder}
          onPointerDown={stopEventPropagation}
          style={{
            border: '1px solid #fb923c',
            background: 'linear-gradient(180deg,#fb923c,#ea580c)',
            color: '#fff',
            borderRadius: 8,
            fontSize: 12.5,
            padding: '8px 16px',
            cursor: 'pointer',
            fontFamily: NODE_MONO,
            boxShadow: '0 2px 10px rgba(234,88,12,0.35)'
          }}
        >
          📁 Выбрать папку проекта
        </button>
      </div>
    )
  }

  const folderName = cwd.split(/[\\/]/).slice(-2).join('/')

  return (
    <div
      onPointerDown={stopEventPropagation}
      // Колесо гасим в BUBBLE-фазе (не capture): сначала его получит xterm внутри
      // (проскроллит терминал/TUI), и только потом мы не даём холсту зумить.
      onWheel={stopEventPropagation}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, height: '100%', fontFamily: NODE_MONO }}
    >
      {/* Тулбар */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          onClick={pickFolder}
          onPointerDown={stopEventPropagation}
          title={cwd}
          style={{
            flex: 1,
            minWidth: 0,
            border: `1px solid ${C.border}`,
            background: '#0d1117',
            color: '#c9d1d9',
            borderRadius: 6,
            fontSize: 11,
            padding: '4px 8px',
            cursor: 'pointer',
            textAlign: 'left',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: NODE_MONO
          }}
        >
          📁 {folderName}
        </button>
        <span
          title={alive ? 'терминал активен' : 'терминал остановлен'}
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: alive ? '#3fb950' : '#6e7681',
            flexShrink: 0
          }}
        />
        <OcToolBtn onClick={() => runCmd('opencode')} title="Запустить opencode" accent>
          ▶ opencode
        </OcToolBtn>
        <OcToolBtn onClick={() => runCmd('opencode auth login')} title="Подключить модель по API-ключу">
          🔑 auth
        </OcToolBtn>
        <OcToolBtn onClick={restart} title="Перезапустить терминал">
          ⟳
        </OcToolBtn>
      </div>

      {/* Сам терминал. Внешний div — реальный размер (за ним следит ResizeObserver),
          внутренний host рендерится в k× плотности и ужимается scale(1/k) → резко. */}
      <div
        ref={wrapRef}
        className="flow-scroll"
        onPointerDown={(e) => {
          stopEventPropagation(e)
          termRef.current?.focus()
        }}
        style={{
          flex: 1,
          minHeight: 90,
          overflow: 'hidden',
          background: '#0d1117',
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: 6
        }}
      >
        <div
          ref={hostRef}
          style={{
            width: `${m * 100}%`,
            height: `${m * 100}%`,
            transform: m === 1 ? undefined : `scale(${1 / m})`,
            transformOrigin: '0 0'
          }}
        />
      </div>
    </div>
  )
}

// ---------- AnythingLLM: встроенный RAG-ассистент (управляемый сайдкар + webview) ----------
type AnyState = {
  phase: string
  message: string
  installed: boolean
  running: boolean
  port: number
  error: string
}
const ANY_PHASE_LABEL: Record<string, string> = {
  idle: 'Готово к установке',
  cloning: 'Скачиваю AnythingLLM…',
  installing: 'Ставлю зависимости…',
  building: 'Собираю интерфейс…',
  migrating: 'Готовлю базу данных…',
  starting: 'Запускаю сервер…',
  running: 'Работает',
  error: 'Ошибка'
}

function AnythingBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const id = String(shape.id)
  void editor
  const [st, setSt] = useState<AnyState | null>(null)
  const [progress, setProgress] = useState<string>('')
  const autoStarted = useRef(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wvRef = useRef<any>(null)

  // Снимок интерфейса (innerText webview) в реестр — для контекста по стрелке.
  useEffect(() => {
    const iv = setInterval(() => {
      const wv = wvRef.current
      if (!wv || !wv.executeJavaScript) return
      try {
        wv.executeJavaScript('document.body ? document.body.innerText : ""')
          .then((txt: string) => setAgentTranscript(id, txt))
          .catch(() => {})
      } catch {
        /* ignore */
      }
    }, 5000)
    return () => clearInterval(iv)
  }, [id])

  useEffect(() => {
    let alive = true
    const poll = () => {
      window.flow.anythingState().then((s) => {
        if (!alive) return
        setSt(s)
        // Уже установлен, но не поднят полностью → сами дозапускаем (в т.ч.
        // перезапустит упавший collector). Установку с нуля НЕ триггерим —
        // её пользователь запускает кнопкой явно.
        if (s.installed && !autoStarted.current && s.phase !== 'error') {
          autoStarted.current = true
          window.flow.anythingEnsure()
        }
      })
    }
    poll()
    const iv = setInterval(poll, 4000)
    const off = window.flow.onAnythingProgress((p) => {
      if (alive) setProgress(ANY_PHASE_LABEL[p.phase] ? `${ANY_PHASE_LABEL[p.phase]} ${p.message || ''}`.trim() : p.message)
    })
    return () => {
      alive = false
      clearInterval(iv)
      off()
    }
  }, [])

  const busy =
    st && !st.running && ['cloning', 'installing', 'building', 'migrating', 'starting'].includes(st.phase)

  const start = () => {
    setProgress('Запускаю…')
    window.flow.anythingEnsure()
  }

  // Запущено → показываем реальный интерфейс AnythingLLM в webview
  if (st?.running) {
    return (
      <div
        onPointerDown={stopEventPropagation}
        style={{ height: '100%', borderRadius: 8, overflow: 'hidden', background: '#0d1117' }}
      >
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {React.createElement('webview' as any, {
          ref: wvRef,
          src: `http://localhost:${st.port}`,
          partition: 'persist:anythingllm',
          allowpopups: 'true',
          style: { width: '100%', height: '100%', border: 'none', background: '#0d1117' }
        })}
      </div>
    )
  }

  // Не запущено — экран установки/прогресса
  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: NODE_SANS,
        color: C.textDim,
        textAlign: 'center',
        padding: 14
      }}
    >
      <div style={{ fontSize: 26 }}>🧠</div>
      {busy ? (
        <>
          <div style={{ fontSize: 12.5, color: C.text }}>
            {ANY_PHASE_LABEL[st!.phase] || 'Устанавливаю…'}
          </div>
          <div style={{ fontSize: 11, color: C.textDim, maxWidth: 260, lineHeight: 1.5 }}>
            {progress || st!.message || 'Первый запуск занимает несколько минут.'}
          </div>
          <div
            style={{
              width: 160,
              height: 3,
              borderRadius: 3,
              background: 'rgba(20,184,166,0.2)',
              overflow: 'hidden',
              position: 'relative'
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(90deg,transparent,#14B8A6,transparent)',
                animation: 'anyshimmer 1.4s linear infinite'
              }}
            />
          </div>
          <style>{`@keyframes anyshimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}`}</style>
        </>
      ) : st?.phase === 'error' ? (
        <>
          <div style={{ fontSize: 12.5, color: C.red }}>Ошибка запуска AnythingLLM</div>
          <div style={{ fontSize: 10.5, color: C.textDim, maxWidth: 270, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {st.error || progress}
          </div>
          <button onClick={start} onPointerDown={stopEventPropagation} style={anyBtnStyle}>
            ↻ Повторить
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: C.text }}>
            {st?.installed ? 'AnythingLLM установлен' : 'AnythingLLM ещё не установлен'}
          </div>
          <div style={{ fontSize: 11, color: C.textDim, maxWidth: 260, lineHeight: 1.5 }}>
            {st?.installed
              ? 'Нажми, чтобы запустить локальный сервер.'
              : 'Flow скачает и поднимет его сам. Первый раз — несколько минут и ~1 ГБ загрузки.'}
          </div>
          <button onClick={start} onPointerDown={stopEventPropagation} style={anyBtnStyle}>
            {st?.installed ? '▶ Запустить' : '⬇ Установить и запустить'}
          </button>
        </>
      )}
    </div>
  )
}

const anyBtnStyle: React.CSSProperties = {
  border: '1px solid #14B8A6',
  background: 'linear-gradient(180deg,#2dd4bf,#0d9488)',
  color: '#04201d',
  fontWeight: 700,
  borderRadius: 8,
  fontSize: 12.5,
  padding: '8px 16px',
  cursor: 'pointer',
  fontFamily: NODE_SANS,
  boxShadow: '0 2px 10px rgba(20,184,166,0.35)'
}

// ---------- OpenScience (@synsci/openscience): встроенный веб-воркспейс ----------
// `openscience serve --port 8790` поднимает headless-сервер, отдающий воркспейс на
// http://localhost:8790 (без TUI и без внешнего браузера). Показываем его прямо в
// ноде через <webview> — воркспейс на доске, а не в браузере. Сервером управляет
// главный процесс (src/main/openscience.ts). Модели/ключи настраиваются в самом
// веб-интерфейсе воркспейса. Требует `npm i -g @synsci/openscience`.
type OsState = { phase: string; message: string; running: boolean; url: string; error: string; cwd?: string }

// ---------- Веб-чат-нода (ChatGPT / Gemini / GLM с логином) ----------
function WebLLMBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const id = String(shape.id)
  const cfg = webLLMConf(shape.props.kind)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wvRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [ctxLen, setCtxLen] = useState(0) // сколько символов снято и доступно связанным нодам

  const runJS = (code: string): Promise<unknown> => {
    const wv = wvRef.current
    if (!wv || !wv.executeJavaScript) return Promise.reject(new Error('webview не готов'))
    return wv.executeJavaScript(code, true)
  }
  // Снять текст диалога из webview в реестр (его видят API-ноды по стрелке). Берём
  // основной контейнер (main/article), иначе весь body. Возвращаем длину снятого.
  const captureNow = useCallback(async (): Promise<number> => {
    try {
      const txt = String(
        (await runJS(
          '(function(){var m=document.querySelector("main")||document.querySelector("[role=main]")||document.querySelector("article");var t=(m&&m.innerText)||(document.body&&document.body.innerText)||"";return t;})()'
        )) || ''
      )
      setAgentTranscript(id, txt)
      const len = (agentTranscripts.get(id) || '').length
      setCtxLen(len)
      return len
    } catch {
      return 0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  const readLast = async (): Promise<string> => {
    try {
      return String((await runJS(cfg.lastReply)) || '')
    } catch {
      return ''
    }
  }

  // Вписать запрос в поле ввода веб-чата и дождаться нового стабильного ответа.
  const ask = useCallback(
    async (text: string, timeoutMs = 150000): Promise<string> => {
      const q = (text || '').trim()
      if (!q) return ''
      const before = await readLast()
      const ok = await runJS(cfg.inject(q)).catch(() => false)
      if (!ok) throw new Error(`Не нашёл поле ввода в ${cfg.name} (нужно войти / открыть чат)`)
      const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
      const t0 = Date.now()
      let last = ''
      let stable = 0
      // Ждём, пока ответ (а) сменится относительно прежнего и (б) перестанет расти ~5с.
      while (Date.now() - t0 < timeoutMs) {
        await sleep(1600)
        const cur = await readLast()
        if (!cur || cur === before) continue
        if (cur === last) {
          stable++
          if (stable >= 3) break
        } else {
          stable = 0
          last = cur
        }
      }
      return (last || (await readLast()) || '').trim()
    },
    [cfg]
  )

  // Регистрируем драйвер, пока нода смонтирована — им пользуется мост оркестратора (App.tsx).
  useEffect(() => {
    webLLMRegistry.set(id, {
      provider: cfg.name,
      ask: (p, t) => ask(p, t),
      lastReply: readLast
    })
    return () => {
      webLLMRegistry.delete(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ask])

  // Готовность webview (для плейсхолдера поля ввода).
  useEffect(() => {
    const wv = wvRef.current
    if (!wv || !wv.addEventListener) return
    const on = (): void => setReady(true)
    wv.addEventListener('dom-ready', on)
    return () => {
      try {
        wv.removeEventListener('dom-ready', on)
      } catch {
        /* ignore */
      }
    }
  }, [])

  // Снимок диалога в реестр — для контекста по стрелке (API-ноды). Периодически +
  // сразу после готовности страницы (иначе первые секунды контекст пустой).
  useEffect(() => {
    void captureNow()
    const iv = setInterval(() => void captureNow(), 3000)
    return () => clearInterval(iv)
  }, [captureNow])

  const sendPrompt = async (): Promise<void> => {
    const q = prompt.trim()
    if (!q || busy) return
    setBusy(true)
    setNote('Отправляю запрос в веб-чат…')
    try {
      const reply = await ask(q)
      if (reply) {
        ensureResultCard(editor, shape.id, reply)
        setNote('Ответ добавлен нодой ✓')
        setPrompt('')
      } else {
        setNote('Ответ не распознан — используйте «➕ ответ в ноду»')
      }
    } catch (e) {
      setNote((e as Error).message)
    } finally {
      setBusy(false)
      setTimeout(() => setNote(''), 4000)
    }
  }

  // Взять последний ответ из веб-чата как есть → отдельная нода-ответ.
  const extractLast = async (): Promise<void> => {
    setNote('Читаю последний ответ…')
    const reply = await readLast()
    if (reply) {
      ensureResultCard(editor, shape.id, reply)
      setNote('Ответ добавлен нодой ✓')
    } else {
      setNote('Не нашёл ответ в чате')
    }
    setTimeout(() => setNote(''), 4000)
  }

  const navBtn: React.CSSProperties = {
    border: 'none',
    background: 'rgba(255,255,255,0.09)',
    color: '#e6edf3',
    width: 24,
    height: 24,
    borderRadius: 6,
    fontSize: 13,
    lineHeight: 1,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontFamily: NODE_SANS
  }

  return (
    <div
      onPointerDown={stopEventPropagation}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: 8, overflow: 'hidden', background: cfg.bg }}
    >
      {/* Тулбар */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '6px 8px',
          background: '#0d1117',
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0
        }}
      >
        <span style={{ font: `700 11px ${NODE_SANS}`, color: KINDS[shape.props.kind]?.color || '#fff', letterSpacing: '.03em' }}>
          {cfg.name}
        </span>
        <button onClick={() => { try { wvRef.current?.reload() } catch { /* ignore */ } }} onPointerDown={stopEventPropagation} style={navBtn} title="Обновить">
          ↻
        </button>
        <button
          onClick={() => void captureNow()}
          onPointerDown={stopEventPropagation}
          style={{ ...navBtn, width: 'auto', padding: '0 7px', gap: 4, color: ctxLen > 0 ? '#4ADE80' : '#8b93a3', fontSize: 10.5, fontWeight: 700 }}
          title={`Снято ${ctxLen} символов диалога. Именно это видят ноды, соединённые с этой веб-нодой СТРЕЛКОЙ. Клик — снять сейчас.`}
        >
          📄 {ctxLen > 999 ? (ctxLen / 1000).toFixed(1) + 'k' : ctxLen}
        </button>
        <div style={{ flex: 1, fontSize: 10, fontFamily: NODE_MONO, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
          {cfg.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
        </div>
        <button onClick={() => { try { window.open(cfg.url, '_blank') } catch { /* ignore */ } }} onPointerDown={stopEventPropagation} style={navBtn} title="Открыть в браузере">
          ↗
        </button>
      </div>
      {/* Webview: своя persist-сессия → логин своим аккаунтом сохраняется */}
      <div style={{ flex: 1, position: 'relative', background: cfg.bg }}>
        {React.createElement('webview' as any, {
          ref: wvRef,
          src: cfg.url,
          partition: cfg.partition,
          allowpopups: 'true',
          style: { width: '100%', height: '100%', border: 'none', background: cfg.bg }
        })}
      </div>
      {/* Ввод: программно вписать запрос в веб-чат и забрать ответ нодой */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '6px 8px', background: '#0d1117', borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
        {note && <div style={{ font: `500 10.5px ${NODE_SANS}`, color: C.textDim }}>{note}</div>}
        <div style={{ display: 'flex', gap: 5 }}>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.currentTarget.value)}
            onPointerDown={stopEventPropagation}
            onKeyDown={(e) => { if (e.code === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendPrompt() } }}
            placeholder={ready ? `Запрос в ${cfg.name}…` : 'Загрузка…'}
            style={{ flex: 1, minWidth: 0, background: C.field, border: `1px solid ${C.border}`, borderRadius: 7, color: C.text, fontSize: 11.5, padding: '6px 9px', fontFamily: NODE_SANS, outline: 'none' }}
          />
          <button
            onClick={() => void sendPrompt()}
            onPointerDown={stopEventPropagation}
            disabled={busy}
            style={{ border: 'none', background: KINDS[shape.props.kind]?.grad, color: '#04121f', fontWeight: 700, borderRadius: 7, fontSize: 11.5, padding: '0 12px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, fontFamily: NODE_SANS }}
            title="Вписать запрос в веб-чат и добавить ответ нодой"
          >
            {busy ? '…' : '➤'}
          </button>
          <button
            onClick={() => void extractLast()}
            onPointerDown={stopEventPropagation}
            style={{ ...navBtn, width: 'auto', padding: '0 9px' }}
            title="Взять последний ответ из чата → отдельная нода"
          >
            ➕
          </button>
        </div>
      </div>
    </div>
  )
}

function OpenscienceBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  const id = String(shape.id)
  const [st, setSt] = useState<OsState | null>(null)
  const [progress, setProgress] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wvRef = useRef<any>(null)
  const started = useRef(false)
  // Папка-проект openscience: сессии/чаты привязаны к ней (worktree). Пустая =
  // домашняя папка. Сохраняем в extra, чтобы нода помнила выбранный проект.
  let osEx: { cwd?: string } = {}
  try {
    osEx = JSON.parse(shape.props.extra || '{}')
  } catch {
    /* ignore */
  }
  const exCwd = osEx.cwd || ''
  const cwdRef = useRef(exCwd)
  cwdRef.current = exCwd
  const folderLabel = exCwd ? exCwd.split(/[\\/]/).slice(-1)[0] : 'домашняя папка'

  // Выбрать папку-проект и (пере)запустить сервер в ней → появятся чаты этого проекта.
  const pickProject = async (): Promise<void> => {
    const r = await window.flow.pickFolder()
    if (!r.ok) return
    update({ extra: JSON.stringify({ ...osEx, cwd: r.path }) })
    cwdRef.current = r.path
    started.current = true
    setProgress('Переключаю проект…')
    setSt((s) => (s ? { ...s, running: false, phase: 'starting' } : s))
    await window.flow.openscienceEnsure({ cwd: r.path })
    // сервер перезапущен в новой папке — перезагружаем webview на её проект
    setTimeout(() => {
      try {
        wvRef.current?.reload()
      } catch {
        /* ignore */
      }
    }, 900)
  }

  // Снимок воркспейса (innerText webview) в реестр — для контекста по стрелке.
  useEffect(() => {
    const iv = setInterval(() => {
      const wv = wvRef.current
      if (!wv || !wv.executeJavaScript) return
      try {
        wv.executeJavaScript('document.body ? document.body.innerText : ""')
          .then((txt: string) => setAgentTranscript(id, txt))
          .catch(() => {})
      } catch {
        /* ignore */
      }
    }, 5000)
    return () => clearInterval(iv)
  }, [id])

  useEffect(() => {
    let alive = true
    const poll = (): void => {
      window.flow.openscienceState().then((s) => {
        if (!alive) return
        setSt(s)
        // Сервер поднимаем автоматически один раз, если он ещё не запущен.
        if (!s.running && !started.current && s.phase !== 'error' && s.phase !== 'starting') {
          started.current = true
          window.flow.openscienceEnsure({ cwd: cwdRef.current || undefined })
        }
      })
    }
    poll()
    const iv = setInterval(poll, 4000)
    const off = window.flow.onOpenscienceProgress((p) => {
      if (alive) setProgress(p.message || '')
    })
    return () => {
      alive = false
      clearInterval(iv)
      off()
    }
  }, [])

  const busy = st?.phase === 'starting'
  const start = (): void => {
    started.current = true
    setProgress('Запускаю…')
    window.flow.openscienceEnsure({ cwd: cwdRef.current || undefined })
  }

  // Сервер поднят → показываем веб-воркспейс OpenScience в webview
  if (st?.running && st.url) {
    return (
      <div
        onPointerDown={stopEventPropagation}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: 8, overflow: 'hidden', background: '#fff' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '6px 8px',
            background: '#0d1117',
            borderBottom: `1px solid ${C.border}`,
            flexShrink: 0
          }}
        >
          <button
            onClick={() => {
              try {
                wvRef.current?.reload()
              } catch {
                /* ignore */
              }
            }}
            onPointerDown={stopEventPropagation}
            style={osciNavBtn}
            title="Обновить"
          >
            ↻
          </button>
          <button
            onClick={pickProject}
            onPointerDown={stopEventPropagation}
            style={{ ...osciNavBtn, width: 'auto', padding: '0 8px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={`Проект (папка): ${exCwd || 'домашняя папка'}. Клик — выбрать другую папку-проект.`}
          >
            📁 {folderLabel}
          </button>
          <div style={{ flex: 1, fontSize: 10.5, fontFamily: NODE_MONO, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
            {st.url.replace(/^https?:\/\//, '')}
          </div>
          <button
            onClick={() => {
              try {
                window.open(st.url, '_blank')
              } catch {
                /* ignore */
              }
            }}
            onPointerDown={stopEventPropagation}
            style={osciNavBtn}
            title="Открыть в браузере"
          >
            ↗
          </button>
        </div>
        <div style={{ flex: 1, position: 'relative', background: '#fff' }}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {React.createElement('webview' as any, {
            ref: wvRef,
            src: st.url,
            partition: 'persist:openscience',
            allowpopups: 'true',
            style: { width: '100%', height: '100%', border: 'none', background: '#fff' }
          })}
        </div>
      </div>
    )
  }

  // Сервер ещё не поднят — прогресс/ошибка/старт
  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: NODE_SANS,
        color: C.textDim,
        textAlign: 'center',
        padding: 14
      }}
    >
      <div style={{ fontSize: 26 }}>🔬</div>
      {busy ? (
        <>
          <div style={{ fontSize: 12.5, color: C.text }}>Поднимаю воркспейс OpenScience…</div>
          <div style={{ fontSize: 10.5, color: C.textDim, maxWidth: 300, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {progress || st?.message || 'openscience serve на localhost:8790…'}
          </div>
          <div style={{ width: 160, height: 3, borderRadius: 3, background: 'rgba(44,123,229,0.2)', overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg,transparent,#2C7BE5,transparent)', animation: 'oscishimmer 1.4s linear infinite' }} />
          </div>
          <style>{`@keyframes oscishimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}`}</style>
        </>
      ) : st?.phase === 'error' ? (
        <>
          <div style={{ fontSize: 12.5, color: C.red }}>Не удалось поднять OpenScience</div>
          <div style={{ fontSize: 10.5, color: C.textDim, maxWidth: 300, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {st.error || progress}
          </div>
          <div style={{ fontSize: 10, color: C.textDim, maxWidth: 300, lineHeight: 1.5 }}>
            Если не установлен: <span style={{ fontFamily: NODE_MONO }}>npm i -g @synsci/openscience</span>
          </div>
          <button onClick={start} onPointerDown={stopEventPropagation} style={osciBtnStyle}>
            ↻ Повторить
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: C.text }}>OpenScience — научный AI-воркбенч</div>
          <div style={{ fontSize: 11, color: C.textDim, maxWidth: 300, lineHeight: 1.5 }}>
            Воркспейс откроется прямо здесь, на доске. Чаты привязаны к папке-проекту.
          </div>
          <button
            onClick={pickProject}
            onPointerDown={stopEventPropagation}
            style={{ ...osciNavBtn, width: 'auto', height: 'auto', padding: '5px 10px', fontSize: 11, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={exCwd || 'домашняя папка'}
          >
            📁 проект: {folderLabel}
          </button>
          <button onClick={start} onPointerDown={stopEventPropagation} style={osciBtnStyle}>
            ▶ Открыть воркспейс
          </button>
        </>
      )}
    </div>
  )
}

const osciNavBtn: React.CSSProperties = {
  border: 'none',
  background: 'rgba(255,255,255,0.07)',
  color: '#c9d1d9',
  width: 22,
  height: 22,
  borderRadius: 5,
  fontSize: 13,
  lineHeight: 1,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  fontFamily: NODE_SANS
}

const osciBtnStyle: React.CSSProperties = {
  border: '1px solid #2C7BE5',
  background: 'linear-gradient(180deg,#5b9cf0,#2C7BE5)',
  color: '#04121f',
  fontWeight: 700,
  borderRadius: 8,
  fontSize: 12.5,
  padding: '8px 16px',
  cursor: 'pointer',
  fontFamily: NODE_SANS,
  boxShadow: '0 2px 10px rgba(44,123,229,0.35)'
}

// ---------- Jupyter/Colab-нода: ячейки кода/markdown, постоянный kernel ----------
type NbOutput =
  | { kind: 'stream'; name: string; text: string }
  | { kind: 'image'; data: string }
  | { kind: 'result'; text: string; html?: string | null }
  | { kind: 'error'; text: string }
type NbCell = {
  id: string
  type: 'code' | 'markdown'
  source: string
  outputs: NbOutput[]
  count: number | null
  running?: boolean
  rendered?: boolean
}

let nbCounter = 0
const nbId = (): string => `cell_${Date.now().toString(36)}_${nbCounter++}`
const NB_FONT = "'JetBrains Mono', monospace"

function loadNb(history: string): NbCell[] {
  try {
    const j = JSON.parse(history || '')
    if (Array.isArray(j?.cells) && j.cells.length) return j.cells as NbCell[]
  } catch {
    /* пустой/битый — начнём с одной ячейки */
  }
  return [{ id: nbId(), type: 'code', source: '', outputs: [], count: null }]
}

function nbEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function highlightPy(src: string): string {
  try {
    return hljs.highlight(src, { language: 'python' }).value
  } catch {
    return nbEscape(src)
  }
}

const nbOut: React.CSSProperties = {
  margin: 0,
  padding: '6px 9px',
  fontFamily: NB_FONT,
  fontSize: 11.5,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: '#0d1117',
  borderRadius: 5,
  color: '#c9d1d9'
}

// Редактор кода: подсвеченный <pre> для просмотра, по клику — чёткая textarea
// для правки (без «прозрачного оверлея», который размывал текст).
const NB_CODE: React.CSSProperties = {
  margin: 0,
  padding: '10px 12px',
  fontFamily: NB_FONT,
  fontSize: 13,
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  boxSizing: 'border-box',
  background: '#0d1117',
  borderRadius: 6,
  minHeight: 54
}
function NbCodeEditor({
  value,
  onChange,
  onCommit,
  onRun
}: {
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  onRun: () => void
}) {
  const [editing, setEditing] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const grow = (ta: HTMLTextAreaElement | null): void => {
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = ta.scrollHeight + 'px'
    }
  }
  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus()
      grow(taRef.current)
    }
  }, [editing])

  if (!editing) {
    return (
      <pre
        onClick={() => setEditing(true)}
        className="hljs"
        style={{ ...NB_CODE, color: '#c9d1d9', cursor: 'text', overflow: 'auto' }}
      >
        {value ? (
          <code style={{ background: 'transparent', padding: 0 }} dangerouslySetInnerHTML={{ __html: highlightPy(value) }} />
        ) : (
          <span style={{ color: C.textDim }}>код… (клик — редактировать)</span>
        )}
      </pre>
    )
  }
  return (
    <textarea
      ref={taRef}
      value={value}
      spellCheck={false}
      onChange={(e) => {
        onChange(e.currentTarget.value)
        grow(e.currentTarget)
      }}
      onBlur={() => {
        setEditing(false)
        onCommit()
      }}
      onPointerDown={stopEventPropagation}
      onKeyDown={(e) => {
        if (e.code === 'Enter' && (e.shiftKey || e.ctrlKey)) {
          e.preventDefault()
          onRun()
          return
        }
        if (e.code === 'Tab') {
          e.preventDefault()
          const ta = e.currentTarget
          const s = ta.selectionStart
          const en = ta.selectionEnd
          onChange(value.slice(0, s) + '    ' + value.slice(en))
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = s + 4
          })
        }
        e.stopPropagation()
      }}
      style={{
        ...NB_CODE,
        width: '100%',
        display: 'block',
        resize: 'none',
        overflow: 'hidden',
        color: '#e6edf3',
        caretColor: '#f9a825',
        border: '1px solid #f9a825',
        outline: 'none'
      }}
    />
  )
}

function NbOutputs({ outputs }: { outputs: NbOutput[] }) {
  if (!outputs.length) return null
  return (
    <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {outputs.map((o, i) => {
        if (o.kind === 'stream')
          return (
            <pre key={i} style={{ ...nbOut, color: o.name === 'stderr' ? '#ffa198' : '#c9d1d9' }}>
              {o.text}
            </pre>
          )
        if (o.kind === 'error')
          return (
            <pre key={i} style={{ ...nbOut, color: '#ffa198', background: 'rgba(248,81,73,0.08)' }}>
              {o.text}
            </pre>
          )
        if (o.kind === 'image')
          return (
            <img
              key={i}
              src={`data:image/png;base64,${o.data}`}
              style={{ maxWidth: '100%', borderRadius: 6, background: '#fff', alignSelf: 'flex-start' }}
            />
          )
        // result
        if (o.html)
          return (
            <div
              key={i}
              className="nb-html"
              style={{ overflow: 'auto', background: '#fff', color: '#111', borderRadius: 6, padding: 6, fontSize: 11.5 }}
              dangerouslySetInnerHTML={{ __html: o.html }}
            />
          )
        return (
          <pre key={i} style={nbOut}>
            {o.text}
          </pre>
        )
      })}
    </div>
  )
}

// Кнопка «запустить» слева от ячейки
function NbRunBtn({ running, onClick }: { running?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      onPointerDown={stopEventPropagation}
      title="Выполнить (Shift+Enter)"
      style={{
        width: 26,
        height: 26,
        borderRadius: '50%',
        border: 'none',
        cursor: 'pointer',
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        fontSize: 12,
        color: '#fff',
        background: running ? '#6e7681' : 'linear-gradient(180deg,#f9a825,#f57f17)'
      }}
    >
      {running ? '…' : '▶'}
    </button>
  )
}

// Защита рендера markdown: битый LaTeX/контент из импортированного .ipynb
// не должен ронять всю ноду — показываем исходник.
class NbSafe extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  render(): React.ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function NbCellView({
  cell,
  onChange,
  onCommit,
  onRun,
  onDelete,
  onAddBelow,
  onMove
}: {
  cell: NbCell
  onChange: (src: string) => void
  onCommit: () => void
  onRun: () => void
  onDelete: () => void
  onAddBelow: (type: 'code' | 'markdown') => void
  onMove: (dir: -1 | 1) => void
}) {
  const [hover, setHover] = useState(false)
  const countLabel = cell.running ? '[*]' : cell.count != null ? `[${cell.count}]` : '[ ]'
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', gap: 6, alignItems: 'flex-start', position: 'relative' }}
    >
      {/* левый жёлоб: запуск + счётчик */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, width: 30, paddingTop: 4 }}>
        <NbRunBtn running={cell.running} onClick={onRun} />
        {cell.type === 'code' && (
          <span style={{ fontSize: 9, color: C.textDim, fontFamily: NB_FONT }}>{countLabel}</span>
        )}
      </div>

      {/* тело ячейки */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {cell.type === 'markdown' && cell.rendered && cell.source.trim() ? (
          <div
            onClick={() => {
              cell.rendered = false
              onCommit()
            }}
            title="Клик — редактировать"
            style={{ background: '#0d1117', borderRadius: 6, padding: '6px 12px', cursor: 'text' }}
          >
            <NbSafe fallback={<pre style={nbOut}>{cell.source}</pre>}>
              <MarkdownView content={cell.source} />
            </NbSafe>
          </div>
        ) : cell.type === 'markdown' ? (
          <textarea
            value={cell.source}
            spellCheck={false}
            onChange={(e) => onChange(e.currentTarget.value)}
            onBlur={onCommit}
            onPointerDown={stopEventPropagation}
            onKeyDown={(e) => {
              if (e.code === 'Enter' && (e.shiftKey || e.ctrlKey)) {
                e.preventDefault()
                onRun()
              }
              e.stopPropagation()
            }}
            placeholder="Markdown… (Shift+Enter — показать)"
            style={{
              width: '100%',
              minHeight: 44,
              boxSizing: 'border-box',
              background: '#0d1117',
              border: `1px dashed ${C.border}`,
              borderRadius: 6,
              color: '#c9d1d9',
              fontFamily: NB_FONT,
              fontSize: 12.5,
              padding: '8px 10px',
              resize: 'vertical',
              outline: 'none'
            }}
          />
        ) : (
          <>
            <NbCodeEditor value={cell.source} onChange={onChange} onCommit={onCommit} onRun={onRun} />
            <NbOutputs outputs={cell.outputs} />
          </>
        )}
      </div>

      {/* панелька действий справа (при наведении) */}
      {hover && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'absolute', right: 0, top: 2 }}>
          {[
            { t: '↑', a: () => onMove(-1), title: 'Выше' },
            { t: '↓', a: () => onMove(1), title: 'Ниже' },
            { t: '🗑', a: onDelete, title: 'Удалить' }
          ].map((b) => (
            <button
              key={b.t}
              onClick={b.a}
              onPointerDown={stopEventPropagation}
              title={b.title}
              style={{
                width: 20,
                height: 20,
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                background: 'rgba(255,255,255,0.08)',
                color: C.textDim,
                fontSize: 10
              }}
            >
              {b.t}
            </button>
          ))}
          <button
            onClick={() => onAddBelow('code')}
            onPointerDown={stopEventPropagation}
            title="Добавить код ниже"
            style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'rgba(255,255,255,0.08)', color: C.textDim, fontSize: 12 }}
          >
            +
          </button>
        </div>
      )}
    </div>
  )
}

// ---- Импорт/экспорт .ipynb (nbformat v4) ----
function srcToLines(s: string): string[] {
  const parts = s.split('\n')
  return parts.map((l, i) => (i < parts.length - 1 ? l + '\n' : l))
}
function joinSrc(s: string | string[] | undefined): string {
  return Array.isArray(s) ? s.join('') : s || ''
}
function cellsToIpynb(cells: NbCell[]): string {
  const nb = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: 'python3', display_name: 'Python 3' },
      language_info: { name: 'python' }
    },
    cells: cells.map((c) => {
      if (c.type === 'markdown')
        return { cell_type: 'markdown', metadata: {}, source: srcToLines(c.source) }
      return {
        cell_type: 'code',
        execution_count: c.count,
        metadata: {},
        source: srcToLines(c.source),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        outputs: c.outputs.map((o: NbOutput): any => {
          if (o.kind === 'stream') return { output_type: 'stream', name: o.name, text: srcToLines(o.text) }
          if (o.kind === 'error') return { output_type: 'error', ename: 'Error', evalue: '', traceback: o.text.split('\n') }
          if (o.kind === 'image') return { output_type: 'display_data', data: { 'image/png': o.data }, metadata: {} }
          return {
            output_type: 'execute_result',
            execution_count: c.count,
            data: { 'text/plain': srcToLines(o.text), ...(o.html ? { 'text/html': srcToLines(o.html) } : {}) },
            metadata: {}
          }
        })
      }
    })
  }
  return JSON.stringify(nb, null, 1)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ipynbToCells(json: any): NbCell[] {
  const cells: NbCell[] = []
  for (const c of json?.cells || []) {
    if (c.cell_type === 'markdown') {
      cells.push({ id: nbId(), type: 'markdown', source: joinSrc(c.source), outputs: [], count: null, rendered: true })
    } else if (c.cell_type === 'code') {
      const outputs: NbOutput[] = []
      for (const o of c.outputs || []) {
        if (o.output_type === 'stream') outputs.push({ kind: 'stream', name: o.name || 'stdout', text: joinSrc(o.text) })
        else if (o.output_type === 'error') outputs.push({ kind: 'error', text: (o.traceback || []).join('\n') })
        else if (o.output_type === 'execute_result' || o.output_type === 'display_data') {
          const d = o.data || {}
          if (d['image/png']) outputs.push({ kind: 'image', data: Array.isArray(d['image/png']) ? d['image/png'].join('') : d['image/png'] })
          else if (d['text/html']) outputs.push({ kind: 'result', text: joinSrc(d['text/plain']), html: joinSrc(d['text/html']) })
          else if (d['text/plain']) outputs.push({ kind: 'result', text: joinSrc(d['text/plain']) })
        }
      }
      cells.push({ id: nbId(), type: 'code', source: joinSrc(c.source), outputs, count: c.execution_count ?? null })
    }
  }
  return cells.length ? cells : [{ id: nbId(), type: 'code', source: '', outputs: [], count: null }]
}

function NotebookBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  const id = String(shape.id)
  const nb = useRef<NbCell[]>(loadNb(shape.props.history))
  const [, force] = useState(0)
  const rerender = (): void => force((n) => n + 1)
  const [ready, setReady] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const ex = parseExtra(shape.props.extra) as { python?: string }
  const [python, setPython] = useState<string>(ex.python || '')
  const [kernels, setKernels] = useState<Array<{ name: string; python: string }>>([])

  const persist = (): void => update({ history: JSON.stringify({ cells: nb.current }) })
  const commit = (): void => {
    rerender()
    persist()
  }

  // Список доступных интерпретаторов (py launcher, conda-окружения, системный)
  useEffect(() => {
    window.flow.notebookKernels().then((r) => {
      if (r.ok) setKernels(r.kernels)
    })
  }, [])

  useEffect(() => {
    window.flow.notebookStart({ id, python: ex.python || undefined })
    const off = window.flow.onNotebookMsg((m: NotebookMsg) => {
      if (m.id !== id) return
      if (m.type === 'ready') {
        setReady(true)
        return
      }
      if (m.type === 'exit') {
        setReady(false)
        return
      }
      const c = nb.current.find((x) => x.id === m.cell)
      if (!c) return
      if (m.type === 'stream') {
        const last = c.outputs[c.outputs.length - 1]
        if (last && last.kind === 'stream' && last.name === m.name) last.text += m.text || ''
        else c.outputs.push({ kind: 'stream', name: m.name || 'stdout', text: m.text || '' })
        rerender()
      } else if (m.type === 'image') {
        c.outputs.push({ kind: 'image', data: m.data || '' })
        rerender()
      } else if (m.type === 'result') {
        c.outputs.push({ kind: 'result', text: m.text || '', html: m.html })
        rerender()
      } else if (m.type === 'error') {
        c.outputs.push({ kind: 'error', text: m.text || '' })
        rerender()
      } else if (m.type === 'done') {
        c.running = false
        c.count = m.count ?? c.count
        commit()
      }
    })
    return () => off()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const runCell = (c: NbCell): void => {
    if (c.type === 'markdown') {
      c.rendered = true
      commit()
      return
    }
    c.outputs = []
    c.running = true
    c.count = null
    rerender()
    window.flow.notebookRun({ id, cell: c.id, code: c.source })
  }
  const runAll = (): void => nb.current.forEach((c) => runCell(c))
  const addCell = (type: 'code' | 'markdown', afterId?: string): void => {
    const cell: NbCell = { id: nbId(), type, source: '', outputs: [], count: null, rendered: false }
    const idx = afterId != null ? nb.current.findIndex((x) => x.id === afterId) + 1 : nb.current.length
    nb.current.splice(idx, 0, cell)
    commit()
  }
  const delCell = (cid: string): void => {
    nb.current = nb.current.filter((x) => x.id !== cid)
    if (!nb.current.length) nb.current = [{ id: nbId(), type: 'code', source: '', outputs: [], count: null }]
    commit()
  }
  const moveCell = (cid: string, dir: -1 | 1): void => {
    const i = nb.current.findIndex((x) => x.id === cid)
    const j = i + dir
    if (i < 0 || j < 0 || j >= nb.current.length) return
    const arr = nb.current
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    commit()
  }
  const restart = async (py?: string): Promise<void> => {
    setReady(false)
    await window.flow.notebookRestart({ id, python: py ?? python ?? undefined })
    nb.current.forEach((c) => {
      c.count = null
      c.running = false
    })
    commit()
  }
  // Сменить интерпретатор: сохранить выбор и перезапустить kernel (состояние сбросится)
  const changeKernel = (py: string): void => {
    setPython(py)
    update({ extra: JSON.stringify({ ...ex, python: py }) })
    restart(py)
  }
  const exportIpynb = (): void => {
    const json = cellsToIpynb(nb.current)
    const b64 = btoa(unescape(encodeURIComponent(json)))
    window.flow.saveFile({ base64: b64, name: (shape.props.title || 'notebook') + '.ipynb' })
  }
  const importFile = async (f: File): Promise<void> => {
    try {
      const text = await f.text()
      nb.current = ipynbToCells(JSON.parse(text))
      commit()
    } catch (e) {
      alert('Не удалось прочитать .ipynb: ' + String(e))
    }
  }

  const tbBtn: React.CSSProperties = {
    border: `1px solid ${C.border}`,
    background: '#0d1117',
    color: '#c9d1d9',
    borderRadius: 6,
    fontSize: 11,
    padding: '4px 8px',
    cursor: 'pointer',
    fontFamily: NODE_SANS,
    whiteSpace: 'nowrap'
  }

  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', fontFamily: NODE_SANS }}
    >
      {/* тулбар */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={runAll} onPointerDown={stopEventPropagation} style={{ ...tbBtn, color: '#f9a825', borderColor: '#f9a825' }}>
          ⏵⏵ Запустить всё
        </button>
        <button onClick={() => addCell('code')} onPointerDown={stopEventPropagation} style={tbBtn}>
          + Код
        </button>
        <button onClick={() => addCell('markdown')} onPointerDown={stopEventPropagation} style={tbBtn}>
          + Markdown
        </button>
        <select
          value={python}
          onChange={(e) => changeKernel(e.currentTarget.value)}
          onPointerDown={stopEventPropagation}
          title="Выбрать интерпретатор (conda / py / системный)"
          style={{ ...selectStyle, fontSize: 11, padding: '3px 6px', maxWidth: 150 }}
        >
          <option value="">ядро: по умолчанию</option>
          {kernels.map((k) => (
            <option key={k.python} value={k.python}>
              {k.name}
            </option>
          ))}
        </select>
        <button onClick={() => restart()} onPointerDown={stopEventPropagation} style={tbBtn} title="Перезапустить kernel (сбросить переменные)">
          ⟳
        </button>
        <div style={{ flex: 1 }} />
        <span
          title={ready ? 'Python готов' : 'Python запускается…'}
          style={{ width: 8, height: 8, borderRadius: '50%', background: ready ? '#3fb950' : '#d29922', flexShrink: 0 }}
        />
        <button onClick={() => fileRef.current?.click()} onPointerDown={stopEventPropagation} style={tbBtn} title="Импорт .ipynb">
          ⬇ Импорт
        </button>
        <button onClick={exportIpynb} onPointerDown={stopEventPropagation} style={tbBtn} title="Экспорт .ipynb">
          ⬆ Экспорт
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".ipynb,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0]
            if (f) importFile(f)
            e.currentTarget.value = ''
          }}
        />
      </div>

      {/* ячейки */}
      <div className="flow-scroll" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
        {nb.current.map((c) => (
          <NbCellView
            key={c.id}
            cell={c}
            onChange={(src) => {
              c.source = src
              rerender()
              persist() // сохраняем сразу, чтобы связанный чат читал актуальный код
            }}
            onCommit={persist}
            onRun={() => runCell(c)}
            onDelete={() => delCell(c.id)}
            onAddBelow={(t) => addCell(t, c.id)}
            onMove={(d) => moveCell(c.id, d)}
          />
        ))}
        <button
          onClick={() => addCell('code')}
          onPointerDown={stopEventPropagation}
          style={{ ...tbBtn, alignSelf: 'flex-start', marginLeft: 36, opacity: 0.7 }}
        >
          + ячейка
        </button>
      </div>
    </div>
  )
}

// ---------- PDF-нода: просмотр страниц + фоновая RAG-индексация ----------
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

// Чтобы не запускать индексацию одного PDF дважды (нода могла ремаунтнуться).
const pdfIndexing = new Set<string>()

// Хайлайт-аннотация на странице PDF. bbox нормализован (0..1) — переживает зум/масштаб.
// T2.2: источник-цитата (номер → страница + якорный текст для подсветки).
type PdfSource = { n: number; page: number; text: string }
type PdfQA = { question: string; answer: string; at: number; sources?: PdfSource[] }
type PdfHighlight = {
  id: string
  page: number
  type: 'text' | 'region'
  content: string
  bbox: { x: number; y: number; width: number; height: number }
  qa: PdfQA[]
}
const nid = (p: string): string => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

function PdfNodeBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  const ex = parseExtra(shape.props.extra) as {
    pdfId?: string
    name?: string
    indexed?: boolean
    highlights?: PdfHighlight[]
    qaModel?: string
    noRag?: boolean // PDF брошен «только на доску» — НЕ индексировать (не эмбеддить)
  }
  const pdfId = ex.pdfId || ''
  const setEx = (patch: Record<string, unknown>): void => update({ extra: JSON.stringify({ ...ex, ...patch }) })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfRef = useRef<any>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pageBoxRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const [page, setPage] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [indexed, setIndexed] = useState(!!ex.indexed)
  const [progress, setProgress] = useState<{ pct: number; msg: string } | null>(null)
  const [highlights, setHighlights] = useState<PdfHighlight[]>(ex.highlights || [])
  const [sel, setSel] = useState<PdfHighlight | null>(null)
  const [drawing, setDrawing] = useState<{ x: number; y: number; width: number; height: number } | null>(null)

  // При отдалении (нода мелкая на экране) не рендерим тяжёлый pdf.js-canvas —
  // показываем лёгкую заглушку. Резко снижает лаги при панораме, когда PDF-нод много.
  const onscreenW = useValue('pdf-onscreen', () => shape.props.w * editor.getZoomLevel(), [editor, shape.props.w])
  const small = onscreenW < 260

  const saveHls = (next: PdfHighlight[]): void => {
    setHighlights(next)
    setEx({ highlights: next })
  }
  const norm = (e: React.PointerEvent): { x: number; y: number } => {
    const r = pageBoxRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    }
  }
  const onSelDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    stopEventPropagation(e)
    const p = norm(e)
    dragRef.current = p
    setSel(null)
    setDrawing({ x: p.x, y: p.y, width: 0, height: 0 })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onSelMove = (e: React.PointerEvent): void => {
    if (!dragRef.current) return
    const p = norm(e)
    const s = dragRef.current
    setDrawing({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      width: Math.abs(p.x - s.x),
      height: Math.abs(p.y - s.y)
    })
  }
  const onSelUp = async (): Promise<void> => {
    const d = drawing
    dragRef.current = null
    setDrawing(null)
    if (!d || d.width < 0.02 || d.height < 0.008) return // слишком мелко — игнор
    let text = ''
    try {
      text = await textInBBox(pdfRef.current, page, d)
    } catch {
      /* ignore */
    }
    const hl: PdfHighlight = {
      id: nid('hl_'),
      page,
      type: text.length > 3 ? 'text' : 'region',
      content: text,
      bbox: d,
      qa: []
    }
    saveHls([...highlights, hl])
    setSel(hl)
  }

  // --- Q&A по выделению: стриминг ответа + RAG + vision ---
  const models = useModels()
  const qaModel = ex.qaModel || ''
  const [question, setQuestion] = useState('')
  const [live, setLive] = useState('') // стримящийся ответ
  const [asking, setAsking] = useState(false)
  const streamRef = useRef<{
    reqId: string
    onToken: (d: string) => void
    onDone: (t: string, sources?: PdfSource[]) => void
    onError: (e: string) => void
  } | null>(null)
  // T2.2: временная подсветка перехода по цитате (страница + фрагмент источника).
  const [flashCite, setFlashCite] = useState<PdfSource | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const goToCitation = (src: PdfSource): void => {
    if (src.page >= 1) setPage(src.page)
    setFlashCite(src)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashCite(null), 5000)
  }

  useEffect(() => {
    const off = window.flow.onPdfStream((m) => {
      const s = streamRef.current
      if (!s || m.reqId !== s.reqId) return
      if (m.channel === 'token') s.onToken(m.delta || '')
      else if (m.channel === 'done') s.onDone(m.text || '', m.sources)
      else s.onError(m.error || 'ошибка')
    })
    return off
  }, [])

  // Кроп области хайлайта из текущего canvas (для vision по диаграмме/скану)
  const cropRegion = (h: PdfHighlight): string | undefined => {
    const c = canvasRef.current
    if (!c || h.page !== page) return undefined
    const sx = h.bbox.x * c.width
    const sy = h.bbox.y * c.height
    const sw = Math.max(1, h.bbox.width * c.width)
    const sh = Math.max(1, h.bbox.height * c.height)
    const off = document.createElement('canvas')
    off.width = sw
    off.height = sh
    const g = off.getContext('2d')
    if (!g) return undefined
    g.drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh)
    return off.toDataURL('image/png')
  }

  const askQuestion = async (h: PdfHighlight): Promise<void> => {
    if (!question.trim() || asking) return
    const q = question.trim()
    setQuestion('')
    setAsking(true)
    setLive('')
    let queryVector: number[] | undefined
    try {
      if (indexed) queryVector = await embedQuery(q)
    } catch {
      /* без RAG-контекста тоже ответим */
    }
    const imageDataUrl = h.type === 'region' ? cropRegion(h) : undefined
    const reqId = nid('q_')
    const finish = (answer: string, sources?: PdfSource[]): void => {
      streamRef.current = null
      setAsking(false)
      setLive('')
      // История Q&A хранится в самом хайлайте (переживает перезагрузку)
      const next = highlights.map((x) =>
        x.id === h.id ? { ...x, qa: [...x.qa, { question: q, answer, at: Date.now(), sources }] } : x
      )
      saveHls(next)
      setSel(next.find((x) => x.id === h.id) || null)
    }
    streamRef.current = {
      reqId,
      onToken: (d) => setLive((a) => a + d),
      onDone: (t, sources) => finish(t, sources),
      onError: (e) => finish('⚠️ ' + e)
    }
    window.flow.pdfAsk({
      reqId,
      model: qaModel,
      pdfId,
      question: q,
      queryVector,
      selection: h.content || undefined,
      imageDataUrl
    })
  }

  // Загрузка PDF с диска + рендер + запуск индексации
  useEffect(() => {
    if (!pdfId) return
    let alive = true
    ;(async () => {
      try {
        const r = await window.flow.pdfBytes({ id: pdfId })
        if (!r.ok) {
          if (alive) setError('PDF не найден: ' + r.error)
          return
        }
        const pdf = await loadPdf(b64ToBytes(r.base64))
        if (!alive) return
        pdfRef.current = pdf
        setNumPages(pdf.numPages)
        setLoaded(true)
        const st = await window.flow.pdfIndexed({ id: pdfId })
        if (st.indexed && st.count > 0) {
          if (alive) setIndexed(true)
        } else if (!pdfIndexing.has(pdfId) && !ex.noRag) {
          // ex.noRag = пользователь бросил PDF «только на доску» → не эмбеддим автоматически.
          indexPdf(pdf)
        }
      } catch (e) {
        if (alive) setError('Не удалось открыть PDF: ' + String(e))
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfId])

  // Рендер текущей страницы (в т.ч. когда нода снова стала крупной — small→false)
  useEffect(() => {
    if (small || !loaded || !pdfRef.current || !canvasRef.current) return
    renderPage(pdfRef.current, page, canvasRef.current, 1.5).catch(() => {})
  }, [loaded, page, small])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const indexPdf = async (pdf: any): Promise<void> => {
    pdfIndexing.add(pdfId)
    try {
      setProgress({ pct: 0, msg: 'Извлечение текста…' })
      const all: Array<{ page: number; text: string }> = []
      for (let pg = 1; pg <= pdf.numPages; pg++) {
        const txt = await extractPageText(pdf, pg)
        for (const c of chunkText(txt)) all.push({ page: pg, text: c })
        setProgress({ pct: (pg / pdf.numPages) * 0.3, msg: `Извлечение текста… стр. ${pg}/${pdf.numPages}` })
      }
      if (!all.length) {
        setProgress(null)
        setIndexed(true)
        setEx({ indexed: true })
        return
      }
      // Первый раз качается модель эмбеддингов (~470 МБ) — показываем прогресс
      setProgress({ pct: 0.3, msg: 'Загрузка модели эмбеддингов…' })
      await loadEmbedder((msg) => setProgress({ pct: 0.3, msg }))
      const vectors = await embedPassages(
        all.map((c) => c.text),
        (done, total) => setProgress({ pct: 0.3 + (done / total) * 0.7, msg: `Индексация ${done}/${total}` })
      )
      await window.flow.pdfIndexAdd({
        id: pdfId,
        chunks: all.map((c, i) => ({ id: `${pdfId}_${i}`, page: c.page, text: c.text, vector: vectors[i] }))
      })
      setProgress(null)
      setIndexed(true)
      setEx({ indexed: true })
    } catch (e) {
      setProgress(null)
      setError('Ошибка индексации: ' + String(e))
    } finally {
      pdfIndexing.delete(pdfId)
    }
  }

  if (!pdfId) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: C.textDim, fontSize: 12 }}>
        Перетащи PDF на холст
      </div>
    )
  }

  // Отдалён → лёгкая заглушка вместо pdf.js-canvas (плавная панорама при многих PDF).
  if (small) {
    return (
      <div
        style={{
          display: 'grid',
          placeItems: 'center',
          alignContent: 'center',
          gap: 8,
          height: '100%',
          padding: '0 14px',
          textAlign: 'center',
          color: C.textDim,
          fontFamily: NODE_SANS
        }}
      >
        <div style={{ fontSize: 40 }}>📄</div>
        <div style={{ fontSize: 13, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {shape.props.title || 'PDF'}
        </div>
        <div style={{ fontSize: 10 }}>приблизь, чтобы открыть</div>
      </div>
    )
  }

  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, height: '100%', fontFamily: NODE_SANS }}
    >
      {/* тулбар: навигация по страницам + статус индексации */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: C.textDim }}>
        <button onClick={() => setPage((p) => Math.max(1, p - 1))} onPointerDown={stopEventPropagation} style={pdfBtn}>
          ◀
        </button>
        <span style={{ minWidth: 54, textAlign: 'center' }}>
          {page} / {numPages || '…'}
        </span>
        <button
          onClick={() => setPage((p) => Math.min(numPages || 1, p + 1))}
          onPointerDown={stopEventPropagation}
          style={pdfBtn}
        >
          ▶
        </button>
        <div style={{ flex: 1 }} />
        {indexed ? (
          <span style={{ color: '#3fb950' }}>● проиндексирован</span>
        ) : progress ? (
          <span style={{ color: '#d29922' }}>{progress.msg}</span>
        ) : (
          <span>готовлюсь…</span>
        )}
      </div>

      {/* страница PDF + слой выделения/хайлайтов */}
      <div
        className="flow-scroll"
        style={{
          flex: sel ? '1 1 38%' : 1,
          minHeight: sel ? 120 : 0,
          overflow: 'auto',
          background: '#525659',
          borderRadius: 6,
          display: 'grid',
          placeItems: 'center',
          padding: 8
        }}
      >
        {error ? (
          <span style={{ color: C.red, fontSize: 12, padding: 12, textAlign: 'center' }}>{error}</span>
        ) : (
          <div
            ref={pageBoxRef}
            onPointerDown={onSelDown}
            onPointerMove={onSelMove}
            onPointerUp={onSelUp}
            style={{ position: 'relative', display: 'inline-block', lineHeight: 0, cursor: 'crosshair' }}
          >
            <canvas ref={canvasRef} style={{ maxWidth: '100%', boxShadow: '0 2px 12px rgba(0,0,0,0.4)', borderRadius: 2, display: 'block' }} />
            {/* T2.2: подсветка перехода по цитате — баннер с фрагментом источника на нужной странице */}
            {flashCite && flashCite.page === page && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  setFlashCite(null)
                }}
                style={{
                  position: 'absolute',
                  left: 6,
                  right: 6,
                  bottom: 6,
                  zIndex: 3,
                  background: 'rgba(88,166,255,.16)',
                  border: '1px solid rgba(88,166,255,.6)',
                  borderRadius: 6,
                  padding: '5px 8px',
                  font: `400 10.5px ${NODE_SANS}`,
                  color: C.text,
                  lineHeight: 1.4,
                  backdropFilter: 'blur(2px)',
                  cursor: 'pointer'
                }}
              >
                <b style={{ color: '#58a6ff' }}>Источник [{flashCite.n}] · стр. {flashCite.page}:</b>{' '}
                {flashCite.text.slice(0, 200)}
                {flashCite.text.length > 200 ? '…' : ''}
              </div>
            )}
            {/* сохранённые хайлайты текущей страницы */}
            {highlights
              .filter((h) => h.page === page)
              .map((h) => (
                <div
                  key={h.id}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSel(h)
                  }}
                  title={h.type === 'text' ? h.content.slice(0, 120) : 'область (диаграмма/скан)'}
                  style={{
                    position: 'absolute',
                    left: `${h.bbox.x * 100}%`,
                    top: `${h.bbox.y * 100}%`,
                    width: `${h.bbox.width * 100}%`,
                    height: `${h.bbox.height * 100}%`,
                    background: h.type === 'text' ? 'rgba(255,235,59,0.32)' : 'rgba(255,107,107,0.12)',
                    border: h.type === 'region' ? '2px solid #FF6B6B' : '1px solid rgba(255,213,0,0.6)',
                    borderRadius: 2,
                    cursor: 'pointer',
                    boxSizing: 'border-box'
                  }}
                />
              ))}
            {/* прямоугольник, который сейчас рисуют */}
            {drawing && (
              <div
                style={{
                  position: 'absolute',
                  left: `${drawing.x * 100}%`,
                  top: `${drawing.y * 100}%`,
                  width: `${drawing.width * 100}%`,
                  height: `${drawing.height * 100}%`,
                  border: '1px dashed #FF6B6B',
                  background: 'rgba(255,107,107,0.15)',
                  boxSizing: 'border-box'
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Q&A по выбранному хайлайту: история + стриминг + ввод */}
      {sel && (
        <div
          style={{
            background: '#0d1117',
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: 8,
            fontSize: 12,
            color: '#c9d1d9',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            flex: '1 1 58%',
            minHeight: 220
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: sel.type === 'text' ? '#ffd54f' : '#FF6B6B', fontSize: 10 }}>
              {sel.type === 'text' ? '✎ текст' : '▢ область'} · стр. {sel.page}
            </span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => {
                saveHls(highlights.filter((h) => h.id !== sel.id))
                setSel(null)
              }}
              onPointerDown={stopEventPropagation}
              title="Удалить хайлайт"
              style={{ ...pdfBtn, padding: '1px 7px', color: C.red }}
            >
              🗑
            </button>
            <button onClick={() => setSel(null)} onPointerDown={stopEventPropagation} style={{ ...pdfBtn, padding: '1px 7px' }}>
              ✕
            </button>
          </div>

          {sel.type === 'text' && sel.content && (
            <div style={{ fontSize: 10.5, color: C.textDim, whiteSpace: 'pre-wrap', maxHeight: 40, overflow: 'auto' }}>
              «{sel.content.slice(0, 300)}»
            </div>
          )}

          {/* история Q&A + текущий стриминг */}
          <div className="flow-scroll" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sel.qa.map((qa, i) => (
              <div key={i}>
                <div style={{ color: '#58a6ff', fontSize: 10, marginBottom: 2 }}>› {qa.question}</div>
                <div style={{ fontSize: 11.5 }}>
                  <MarkdownView content={qa.answer} />
                </div>
                {qa.sources && qa.sources.length > 0 && (
                  <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: C.textDim }}>Источники:</span>
                    {qa.sources.map((s) => (
                      <button
                        key={s.n}
                        onClick={() => goToCitation(s)}
                        onPointerDown={stopEventPropagation}
                        title={`Перейти на стр. ${s.page}`}
                        style={{
                          font: `600 10px ${NODE_MONO}`,
                          color: '#58a6ff',
                          background: 'rgba(88,166,255,.12)',
                          border: '1px solid rgba(88,166,255,.35)',
                          borderRadius: 5,
                          padding: '1px 6px',
                          cursor: 'pointer'
                        }}
                      >
                        [{s.n}] с.{s.page}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {asking && (
              <div>
                <div style={{ color: '#58a6ff', fontSize: 10, marginBottom: 2 }}>⌛…</div>
                <div style={{ fontSize: 11.5, whiteSpace: 'pre-wrap' }}>{live || '…'}</div>
              </div>
            )}
          </div>

          {/* выбор модели (для области нужна vision-модель) + ввод */}
          {models.length > 0 && (
            <select
              value={qaModel}
              onChange={(e) => setEx({ qaModel: e.currentTarget.value })}
              style={{ ...selectStyle, fontSize: 10.5, padding: '3px 6px' }}
            >
              <option value="">модель по умолчанию</option>
              {models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.group} · {m.label}
                </option>
              ))}
            </select>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={question}
              onChange={(e) => setQuestion(e.currentTarget.value)}
              onPointerDown={stopEventPropagation}
              onKeyDown={(e) => {
                if (e.code === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  askQuestion(sel)
                }
                e.stopPropagation()
              }}
              placeholder={sel.type === 'region' ? 'Вопрос по области (нужна vision-модель)…' : 'Задать вопрос по фрагменту…'}
              style={{
                flex: 1,
                background: C.field,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                color: C.text,
                fontSize: 11.5,
                padding: '5px 8px',
                outline: 'none'
              }}
            />
            <button
              onClick={() => askQuestion(sel)}
              onPointerDown={stopEventPropagation}
              disabled={asking || !question.trim()}
              style={{
                border: 'none',
                borderRadius: 6,
                background: asking ? '#3a3a3c' : 'linear-gradient(180deg,#ff8a8a,#FF6B6B)',
                color: '#fff',
                fontSize: 13,
                padding: '5px 12px',
                cursor: asking ? 'default' : 'pointer'
              }}
            >
              {asking ? '…' : '➤'}
            </button>
          </div>
        </div>
      )}

      {/* progress-bar индексации снизу */}
      {progress && (
        <div style={{ height: 3, borderRadius: 3, background: 'rgba(255,107,107,0.2)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.round(progress.pct * 100)}%`, background: '#FF6B6B', transition: 'width 0.2s' }} />
        </div>
      )}
    </div>
  )
}

const pdfBtn: React.CSSProperties = {
  border: `1px solid ${C.border}`,
  background: '#0d1117',
  color: '#c9d1d9',
  borderRadius: 6,
  fontSize: 12,
  padding: '2px 9px',
  cursor: 'pointer'
}

// ============================================================================
// Мета-нода Оркестратора. Запускает движок (main/orchestrator) и в реальном
// времени показывает дерево подзадач со статусами, ленту трейса, бар бюджета и
// карточки human-review. Рантайм-состояние — в React-state (как agentTranscripts):
// в props шейпа оно не пишется, чтобы не раздувать undo/сохранение.
// ============================================================================
type OTask = {
  id: string
  description: string
  deps: string[]
  mode: string
  success_criteria: string
  size: string
}
type OStatus = { projectId: string; task_id: string; status: string; mode?: string; summary?: string }
type OTrace = {
  task_id: string
  node_id: string
  mode: string
  input_refs: string[]
  output_ref: string
  cost: { tokens: number; calls: number }
  duration_ms: number
  note?: string
  workflow_profile: WorkflowProfile
}
type OHuman = { request_id: string; task_id: string; reason: string; best_summary: string }

const STATUS_META: Record<string, { color: string; label: string }> = {
  pending: { color: C.textDim, label: 'ожидает' },
  running: { color: C.blue, label: 'выполняется' },
  success: { color: '#4ADE80', label: 'готово' },
  partial: { color: '#FBBF24', label: 'частично' },
  failure: { color: '#F87171', label: 'провал' },
  needs_human_review: { color: '#A78BFA', label: 'нужно решение' }
}
const MODE_LABEL: Record<string, string> = {
  pipeline: 'Pipeline',
  actor_critic: 'Actor-Critic',
  council: 'Council',
  ensemble: 'Ensemble',
  recursive: 'Recursive',
  planner: 'Planner'
}

// Слои DAG (longest-path) — для раскладки нод оверлея по колонкам.
function computeLayers(tasks: OTask[]): Map<string, number> {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const memo = new Map<string, number>()
  const layer = (id: string, stack: Set<string>): number => {
    if (memo.has(id)) return memo.get(id)!
    const t = byId.get(id)
    if (!t || !t.deps.length) {
      memo.set(id, 0)
      return 0
    }
    if (stack.has(id)) return 0 // защита от цикла
    stack.add(id)
    let m = 0
    for (const d of t.deps) m = Math.max(m, 1 + layer(d, stack))
    stack.delete(id)
    memo.set(id, m)
    return m
  }
  const out = new Map<string, number>()
  for (const t of tasks) out.set(t.id, layer(t.id, new Set()))
  return out
}

// Найти ноду-подзадачу оверлея по проекту+taskId.
function findOrchTaskShape(editor: Editor, projectId: string, taskId: string): FlowNodeShape | undefined {
  return editor.getCurrentPageShapes().find((s) => {
    if (s.type !== 'flow-node') return false
    const p = (s as FlowNodeShape).props
    if (p.kind !== 'orchtask') return false
    try {
      const e = JSON.parse(p.extra || '{}')
      return e.orchProject === projectId && e.taskId === taskId
    } catch {
      return false
    }
  }) as FlowNodeShape | undefined
}

// Удалить прошлый оверлей этой мета-ноды (ноды подзадач + вызовов + стрелки).
function clearOverlay(editor: Editor, metaId: string): void {
  const ids = editor
    .getCurrentPageShapes()
    .filter((s) => {
      if (s.type !== 'flow-node') return false
      const p = (s as FlowNodeShape).props
      if (p.kind !== 'orchtask' && p.kind !== 'orchcall') return false
      try {
        return JSON.parse(p.extra || '{}').orchMeta === metaId
      } catch {
        return false
      }
    })
    .map((s) => s.id)
  if (!ids.length) return
  const arrows = new Set<string>()
  for (const id of ids) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const b of (editor as any).getBindingsToShape(id, 'arrow')) arrows.add(b.fromId)
    } catch {
      /* API отличается */
    }
  }
  editor.deleteShapes([...arrows, ...ids] as never)
}

// Создать canvas-оверлей. Раскладка «дорожками»: каждая подзадача — своя строка
// (слева направо по слоям DAG для порядка), а её вызовы ролей вырастают ВПРАВО в
// той же строке (см. addCallNode) — так вызовам всегда хватает места, без коллизий.
function createOverlay(editor: Editor, metaId: string, projectId: string, tasks: OTask[]): void {
  const meta = editor.getShape<FlowNodeShape>(metaId as never)
  if (!meta) return
  const mx = meta.x
  const my = meta.y
  const mw = meta.props.w
  const NW = 232
  const NH = 148
  const ROWGAP = 46
  // Порядок строк: по слою DAG, затем по исходному порядку (зависимости выше).
  const layers = computeLayers(tasks)
  const ordered = [...tasks].sort((a, b) => (layers.get(a.id)! - layers.get(b.id)!) || 0)
  const idOf = new Map<string, string>()
  const subX = mx + mw + 110
  ordered.forEach((t, i) => {
    const sid = createShapeId()
    idOf.set(t.id, sid)
    editor.createShape<FlowNodeShape>({
      id: sid,
      type: 'flow-node',
      x: subX,
      y: my + i * (NH + ROWGAP),
      props: {
        kind: 'orchtask',
        title: t.id,
        body: t.description,
        w: NW,
        h: NH,
        extra: JSON.stringify({
          orchProject: projectId,
          orchMeta: metaId,
          taskId: t.id,
          mode: t.mode,
          status: 'pending',
          deps: t.deps,
          size: t.size,
          success: t.success_criteria,
          callCount: 0,
          lastCallId: ''
        })
      }
    })
  })
  // Стрелки зависимостей между подзадачами (строками); входы — от мета-ноды.
  for (const t of tasks) {
    const to = idOf.get(t.id)
    if (!to) continue
    if (t.deps.length) {
      for (const d of t.deps) {
        const from = idOf.get(d)
        if (from) connectArrow(editor, from, to)
      }
    } else {
      connectArrow(editor, metaId, to)
    }
  }
}

// Добавить ноду-вызов роли в дорожку своей подзадачи (по приходу трейса).
// Вызовы выстраиваются в цепочку вправо: подзадача → вызов0 → вызов1 → …
function addCallNode(editor: Editor, metaId: string, projectId: string, entry: OTrace): void {
  const sub = findOrchTaskShape(editor, projectId, entry.task_id)
  if (!sub) return // трейс планировщика / чужой ветки / оверлей выключен
  let e: Record<string, unknown> = {}
  try {
    e = JSON.parse(sub.props.extra || '{}')
  } catch {
    /* ignore */
  }
  const idx = (e.callCount as number) || 0
  const lastId = (e.lastCallId as string) || ''
  const CW = 200
  const CH = 132
  const GAPX = 30
  const cx = sub.x + sub.props.w + 46 + idx * (CW + GAPX)
  const cy = sub.y + (sub.props.h - CH) / 2
  const sid = createShapeId()
  editor.createShape<FlowNodeShape>({
    id: sid,
    type: 'flow-node',
    x: cx,
    y: cy,
    props: {
      kind: 'orchcall',
      title: entry.node_id,
      body: entry.note || '',
      w: CW,
      h: CH,
      extra: JSON.stringify({
        orchProject: projectId,
        orchMeta: metaId,
        taskId: entry.task_id,
        callIndex: idx,
        node_id: entry.node_id,
        mode: entry.mode,
        note: entry.note,
        outputRef: entry.output_ref,
        inputRefs: entry.input_refs,
        cost: entry.cost,
        duration: entry.duration_ms
      })
    }
  })
  connectArrow(editor, lastId || sub.id, sid)
  // Накопить агрегат на ноде подзадачи + запомнить последний вывод/контекст.
  const prev = (e.cost as { tokens: number; calls: number }) || { tokens: 0, calls: 0 }
  editor.updateShape<FlowNodeShape>({
    id: sub.id,
    type: 'flow-node',
    props: {
      extra: JSON.stringify({
        ...e,
        callCount: idx + 1,
        lastCallId: sid,
        outputRef: entry.output_ref || e.outputRef,
        inputRefs: entry.input_refs && entry.input_refs.length ? entry.input_refs : e.inputRefs,
        cost: { tokens: prev.tokens + (entry.cost?.tokens || 0), calls: prev.calls + (entry.cost?.calls || 0) }
      })
    }
  })
}

// Пропатчить extra ноды-подзадачи (live-статус / стоимость / ссылки Vault).
function patchOrchTask(editor: Editor, projectId: string, taskId: string, patch: Record<string, unknown>): void {
  const sh = findOrchTaskShape(editor, projectId, taskId)
  if (!sh) return
  let e: Record<string, unknown> = {}
  try {
    e = JSON.parse(sh.props.extra || '{}')
  } catch {
    /* ignore */
  }
  editor.updateShape<FlowNodeShape>({ id: sh.id, type: 'flow-node', props: { extra: JSON.stringify({ ...e, ...patch }) } })
}

function OrchestratorBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  const { body, model } = shape.props
  let ex: {
    projectId?: string
    project_token_budget?: number
    max_recursion_depth?: number
    max_iterations_per_mode?: number
    max_parallel_nodes?: number
    sci?: boolean
    sciToKb?: boolean
    workflowProfile?: unknown
  } = {}
  try {
    ex = JSON.parse(shape.props.extra || '{}')
  } catch {
    /* ignore */
  }
  const setEx = (patch: Record<string, unknown>) => update({ extra: JSON.stringify({ ...ex, ...patch }) })
  // Дефолты выкручены на максимум — оркестратор работает мощно «из коробки».
  const budgetLimit = ex.project_token_budget ?? 1000000
  // Вменяемые дефолты: при 8/10/10 веер вызовов разрастался экспоненциально
  // (рекурсия глубиной 8 → тысячи подзадач → шквал → rate-limit → зависания/провал).
  const maxDepth = ex.max_recursion_depth ?? 2
  const maxIter = ex.max_iterations_per_mode ?? 3
  const maxParallel = ex.max_parallel_nodes ?? 4
  const workflowProfileResult = WorkflowProfileSchema.safeParse(ex.workflowProfile ?? DEFAULT_WORKFLOW_PROFILE)
  const overlayOn = (ex as { canvasOverlay?: boolean }).canvasOverlay !== false // по умолчанию вкл.
  const overlayEnabledRef = useRef(overlayOn)
  overlayEnabledRef.current = overlayOn
  const overlayForRef = useRef('')
  // Авто-построение нод из результата после завершения (по умолчанию вкл).
  const autoBuild = (ex as { autoBuild?: boolean }).autoBuild !== false
  const autoBuildRef = useRef(autoBuild)
  autoBuildRef.current = autoBuild
  const buildRef = useRef<() => void>(() => {})

  const [running, setRunning] = useState(false)
  const [projectId, setProjectId] = useState<string>(ex.projectId || '')
  const projectRef = useRef(projectId)
  projectRef.current = projectId
  const [tasks, setTasks] = useState<OTask[]>([])
  const [statuses, setStatuses] = useState<Record<string, OStatus>>({})
  const [traces, setTraces] = useState<OTrace[]>([])
  const [humans, setHumans] = useState<OHuman[]>([])
  const [rootDone, setRootDone] = useState<string>('')
  const [spent, setSpent] = useState(0)
  const [showTrace, setShowTrace] = useState(true)
  const [copied, setCopied] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  // Модели под-агентов (роли реестра) + список доступных моделей.
  const [roleModels, setRoleModels] = useState<Array<{ node_id: string; type: string; model: string }>>([])
  const [regDefault, setRegDefault] = useState('')
  const [modelOpts, setModelOpts] = useState<{ value: string; label: string; group: string }[]>([])
  useEffect(() => {
    if (!showSettings) return
    window.flow.orchRegistry?.().then((r) => {
      if (r?.ok) {
        setRoleModels(r.roles)
        setRegDefault(r.default)
      }
    }).catch(() => {})
    window.flow.listModels?.().then(setModelOpts).catch(() => {})
  }, [showSettings])
  const setRoleModel = (nodeId: string, model: string): void => {
    window.flow.orchRegistrySet?.({ nodeId, model }).then(() => {
      setRoleModels((rs) => rs.map((r) => (r.node_id === nodeId ? { ...r, model: model || regDefault } : r)))
    }).catch(() => {})
  }

  // Подписки на события движка (один раз). Фильтруем по текущему projectId.
  useEffect(() => {
    const mine = (pid: string) => pid === projectRef.current
    const offStatus = window.flow.onOrchStatus((m: OStatus) => {
      if (!mine(m.projectId)) return
      if (m.task_id === '__tree__') {
        if ((m.depth || 0) > 0) return // дерево саб-оркестратора не перезатирает родительское
        try {
          const parsed = JSON.parse(m.summary || '[]') as OTask[]
          setTasks(parsed)
          // Canvas-оверлей: создаём ноды подзадач по слоям DAG (один раз на проект).
          if (overlayEnabledRef.current && overlayForRef.current !== projectRef.current) {
            overlayForRef.current = projectRef.current
            try {
              createOverlay(editor, shape.id, projectRef.current, parsed)
            } catch {
              /* холст мог измениться — не критично */
            }
          }
        } catch {
          /* ignore */
        }
        return
      }
      if (m.task_id === '__budget__') return // алерты бюджета отражаются через spent-бар
      setStatuses((s) => ({ ...s, [m.task_id]: m }))
      patchOrchTask(editor, m.projectId, m.task_id, { status: m.status, ...(m.mode ? { mode: m.mode } : {}) })
    })
    const offTrace = window.flow.onOrchTrace((m: { projectId: string; entry: OTrace }) => {
      if (!mine(m.projectId)) return
      setTraces((t) => [m.entry, ...t].slice(0, 200))
      setSpent((v) => v + (m.entry.cost?.tokens || 0))
      // Оверлей вызовов ролей: каждый трейс = отдельная нода-вызов в дорожке
      // своей подзадачи (+ накопление стоимости/ссылок на ноде подзадачи).
      if (overlayEnabledRef.current) {
        try {
          addCallNode(editor, shape.id, m.projectId, m.entry)
        } catch {
          /* холст мог измениться */
        }
      }
    })
    const offDone = window.flow.onOrchDone((m: { projectId: string; result: { status: string; summary: string } }) => {
      if (!mine(m.projectId)) return
      setRunning(false)
      setRootDone(`${STATUS_META[m.result.status]?.label ?? m.result.status}: ${m.result.summary}`)
      // Авто-построение нод из результата: сами подзадачи оркестратора генерируют
      // текст, а реальные ноды создаёт этот шаг (даёт ИИ «руки» на холсте).
      // Дадим React дорисовать статусы/трейс (setState в этом же тике), потом строим.
      if (autoBuildRef.current) setTimeout(() => buildRef.current(), 600)
    })
    const offHuman = window.flow.onOrchHumanRequest((m: OHuman & { project_id: string }) => {
      if (!mine(m.project_id)) return
      setHumans((h) => [...h, { request_id: m.request_id, task_id: m.task_id, reason: m.reason, best_summary: m.best_summary }])
    })
    return () => {
      offStatus()
      offTrace()
      offDone()
      offHuman()
    }
  }, [])

  const start = async () => {
    const goal = (body || '').trim()
    if (!goal) return
    if (!workflowProfileResult.success) {
      setRootDone('Ошибка запуска: некорректный профиль оркестрации')
      return
    }
    // Убрать прошлый canvas-оверлей этой мета-ноды перед новым прогоном.
    try {
      clearOverlay(editor, shape.id)
    } catch {
      /* ignore */
    }
    overlayForRef.current = ''
    setRunning(true)
    setTasks([])
    setStatuses({})
    setTraces([])
    setHumans([])
    setRootDone('')
    setSpent(0)
    // Контекст = всё, что соединено стрелкой с нодой-оркестратором (в любую
    // сторону): заметки, документы, ответы ИИ, ноутбуки, транскрипты агент-нод.
    // Собираем ПОСЛЕ clearOverlay, чтобы не втянуть собственные оверлей-ноды.
    const ctxParts = gatherChatContext(editor, shape.id, ORCH_SKIP_KINDS)
    // Научный поиск: подтягиваем свежие статьи по цели в материалы оркестрации.
    if ((ex as { sci?: boolean }).sci) {
      try {
        const pr = await window.flow.papersSearch({ query: goal, sources: ['openalex'], limit: 12 })
        if (pr.ok && pr.results.length) {
          const papersTxt = pr.results
            .map(
              (p, i) =>
                `[S${i + 1}] ${p.title} (${p.authors.slice(0, 3).join(', ')}${p.year ? ', ' + p.year : ''})` +
                (p.doi ? ` DOI:${p.doi}` : '') +
                (p.abstract ? `\n${p.abstract.slice(0, 600)}` : '')
            )
            .join('\n\n')
          ctxParts.push('НАУЧНЫЕ СТАТЬИ ПО ТЕМЕ (источники, ссылайся как [S1], [S2]):\n' + papersTxt)
          // Авто-заливка найденных статей в базу знаний AnythingLLM.
          if ((ex as { sciToKb?: boolean }).sciToKb) {
            for (const p of pr.results.slice(0, 12)) {
              try {
                const res = await window.flow.papersPdf({ doi: p.doi, pdfUrl: p.pdfUrl, source: p.source })
                if (res.ok) await window.flow.anythingIngest({ base64: res.base64, name: p.title })
              } catch {
                /* пропускаем недоступные */
              }
            }
          }
        }
      } catch {
        /* поиск не критичен */
      }
    }
    const materials = ctxParts.join('\n\n---\n\n')
    const res = await window.flow.orchStart(
      buildOrchestratorStartArgs({
        goal,
        model,
        materials: materials || undefined,
        workflowProfile: workflowProfileResult.data,
        budget: {
          project_token_budget: budgetLimit,
          max_recursion_depth: maxDepth,
          max_iterations_per_mode: maxIter,
          max_parallel_nodes: maxParallel
        }
      })
    )
    if (res.ok && res.projectId) {
      setProjectId(res.projectId)
      projectRef.current = res.projectId
      setEx({ projectId: res.projectId })
    } else {
      setRunning(false)
      setRootDone(`Ошибка запуска: ${res.error || 'неизвестно'}`)
    }
  }

  const cancel = async () => {
    if (projectId) await window.flow.orchCancel({ projectId })
    setRunning(false)
  }

  // Собрать «мысли» оркестратора (цель, задачи со статусами, полный трейс, итог)
  // в читаемый текст и скопировать в буфер обмена.
  const copyThoughts = async () => {
    const lines: string[] = []
    lines.push('=== ОРКЕСТРАТОР ===')
    lines.push('Цель: ' + (body || '').trim())
    if (rootDone) lines.push('Итог: ' + rootDone)
    lines.push(`Бюджет: ${spent} / ${budgetLimit} токенов`)
    lines.push('')
    lines.push('ЗАДАЧИ:')
    for (const t of tasks) {
      const st = statuses[t.id]?.status || 'pending'
      const meta = STATUS_META[st] || STATUS_META.pending
      lines.push(
        `- [${meta.label}] ${t.id}: ${t.description}` +
          ` (${MODE_LABEL[statuses[t.id]?.mode || t.mode] || t.mode}` +
          (t.deps.length ? `, зависит: ${t.deps.join(', ')}` : '') +
          (t.size === 'large' ? ', крупная' : '') +
          ')'
      )
    }
    lines.push('')
    lines.push(`ТРЕЙС ВЫЗОВОВ (${traces.length}):`)
    // трейс храним новыми-сверху → печатаем в хронологическом порядке
    for (const tr of [...traces].reverse()) {
      lines.push(
        `- ${MODE_LABEL[tr.mode] || tr.mode} · ${tr.node_id} · ${tr.cost.tokens}ток · ${Math.round(tr.duration_ms / 100) / 10}с` +
          (tr.note ? ` · ${tr.note}` : '')
      )
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* буфер недоступен */
    }
  }

  // Построить/заполнить ноды из результата оркестрации: одна модель-синтез
  // превращает наработки в действия на холсте (создать ноутбук/канбан, заполнить
  // подключённый бэклог и т.п.).
  const [building, setBuilding] = useState(false)
  const buildFromResult = async () => {
    if (building) return
    const goal = (body || '').trim()
    if (!goal) return
    setBuilding(true)
    try {
      const notes = [...traces].reverse().map((t) => t.note).filter(Boolean).join('\n').slice(0, 5000)
      const taskLines = tasks.map((t) => `- ${t.description} [${statuses[t.id]?.status || 'pending'}]`).join('\n')
      const baseCtx =
        `Цель проекта: ${goal}\n\nПодзадачи:\n${taskLines}\n` + (notes ? `\nНаработки/мысли:\n${notes}\n` : '')
      let filled = 0
      let created = 0

      // 1) ПРИЦЕЛЬНО заполняем каждую уже подключённую ноду отдельным вызовом —
      // так модель точно наполняет существующую ноду, а не создаёт дубликат.
      const conn = connectedBuildable(editor, shape.id)
      for (const node of conn) {
        try {
          const k = node.kind
          const fmt =
            k === 'notebook'
              ? 'Верни СТРОГО JSON: {"cells":[{"type":"markdown","source":"# Заголовок\\nтекст"},{"type":"code","source":"рабочий Python"}]}. 8–20 ячеек, чередуй объяснение и код.'
              : k === 'board'
                ? 'Верни СТРОГО JSON: {"boards":[{"name":"...","columns":[{"name":"Идеи","cards":["конкретная задача 1","задача 2"]}]}]}. Разложи задачи по колонкам.'
                : k === 'kanban'
                  ? 'Верни СТРОГО JSON: {"columns":[{"name":"Нужно сделать","cards":["задача 1","задача 2"]}]}.'
                  : k === 'list'
                    ? 'Верни СТРОГО JSON: {"columns":[{"name":"Категория","cards":["пункт 1"]}]}.'
                    : 'Верни просто markdown-текст (без JSON и пояснений).'
          const sys =
            `Ты наполняешь конкретную ноду на холсте (тип «${KIND_NAME[k] || k}») содержимым по цели проекта. ` +
            fmt +
            ' Никаких пояснений вне ответа.'
          const usr = baseCtx + `\nНаполни ноду «${node.title || KIND_NAME[k] || k}» конкретным содержимым по теме.`
          // Сборка — на модели по умолчанию (модель ноды может быть мёртвой, напр. Cherry
          // с невалидным ключом — тогда авто-сборка молча падала и писала «нечего строить»).
          const r = await window.flow.aiChat({ model: '', messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }] })
          if (!r.ok) continue
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let data: any = null
          if (k === 'note' || k === 'doc') data = { body: r.content.trim() }
          else if (k === 'list') {
            const m = r.content.match(/\{[\s\S]*\}/)
            try {
              const j = m ? JSON.parse(m[0]) : null
              // list хранит группы иначе — заполним как канбан-подобные колонки в extra.list
              if (j?.columns) data = j
            } catch {
              /* ignore */
            }
          } else {
            const m = r.content.match(/\{[\s\S]*\}/)
            try {
              data = m ? JSON.parse(m[0]) : null
            } catch {
              /* ignore */
            }
          }
          if (data && k !== 'list' && applyFillToNode(editor, node.id, k, data)) filled++
        } catch {
          /* одна нода не должна ронять остальные */
        }
      }

      // 2) СОЗДАЁМ недостающие ноды, которые требует цель (только create).
      const sys2 =
        'Ты СОЗДАЁШЬ на холсте ноды, которые требует цель проекта и которых ещё НЕТ среди подключённых. ' +
        'Если всё нужное уже есть среди подключённых — верни пустой список.' +
        canvasToolsPrompt(editor, shape.id) +
        '\nВАЖНО: используй ТОЛЬКО op:"create" (подключённые ноды уже заполнены отдельно, их НЕ дублируй).'
      const res2 = await window.flow.aiChat({
        model: '',
        messages: [{ role: 'system', content: sys2 }, { role: 'user', content: baseCtx + '\nСоздай недостающие ноды (только create).' }]
      })
      let extraRep = ''
      if (res2.ok) {
        const { actions } = parseFlowActions(res2.content)
        // Разрешаем create новых нод и papers (поиск+скачивание статей на холст/в базу).
        const allowed = actions.filter((a) => a?.op === 'create' || a?.op === 'papers')
        extraRep = await applyFlowActions(editor, shape.id, allowed)
        const m = extraRep.match(/создано нод: (\d+)/)
        if (m) created += Number(m[1])
      }

      const parts: string[] = []
      if (filled) parts.push(`заполнено нод: ${filled}`)
      const papersRep = /стат|AnythingLLM/.test(extraRep) ? extraRep : ''
      if (created) parts.push(`создано нод: ${created}`)
      if (papersRep) parts.push(papersRep.replace(/создано нод: \d+ ?·? ?/, '').trim())
      setRootDone((r) => (r ? r + ' · ' : '') + (parts.filter(Boolean).length ? `🛠 ${parts.filter(Boolean).join(' · ')}` : '🛠 нечего строить'))
    } catch (e) {
      setRootDone((r) => (r ? r + ' · ' : '') + `🛠 ошибка: ${String(e)}`)
    } finally {
      setBuilding(false)
    }
  }
  buildRef.current = buildFromResult // для авто-построения из offDone

  const decide = async (req: OHuman, decision: 'approve' | 'reject' | 'edit', feedback?: string) => {
    await window.flow.orchHumanDecision({ projectId, requestId: req.request_id, decision: { decision, feedback } })
    setHumans((h) => h.filter((x) => x.request_id !== req.request_id))
  }

  const frac = Math.min(1, spent / Math.max(1, budgetLimit))
  const barColor = frac >= 1 ? '#F87171' : frac >= 0.8 ? '#FBBF24' : C.blue
  const numStyle = { ...fieldStyle, width: 72, padding: '4px 6px', fontSize: 11.5 } as const
  // Живой счётчик нод, подключённых стрелкой (их содержимое пойдёт в контекст).
  const connectedCount = gatherChatContext(editor, shape.id, ORCH_SKIP_KINDS).length

  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', overflow: 'hidden' }}
    >
      <ModelSelect value={model} onChange={(v) => update({ model: v })} />

      <textarea
        className="flow-input flow-scroll"
        value={body}
        onChange={(e) => update({ body: e.currentTarget.value })}
        placeholder="🕸 Опиши проект целиком — планировщик разобьёт его на подзадачи и выберет режимы…"
        style={{ ...fieldStyle, minHeight: 120, maxHeight: 240, resize: 'none', lineHeight: 1.55, fontSize: 13.5 }}
      />

      {/* Контекст по стрелкам + шестерёнка настроек */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{ flex: 1, fontSize: 11, color: connectedCount ? '#4ADE80' : C.textDim }}
          title="Соедини ноды стрелкой с оркестратором — их содержимое станет контекстом"
        >
          🔗 Контекст: {connectedCount ? `${connectedCount} нод по стрелкам` : 'нет (соедини ноды стрелкой)'}
        </div>
        <button
          onClick={() => setShowSettings((v) => !v)}
          title="Настройки оркестрации (лимиты, бюджет)"
          style={{
            border: `1px solid ${showSettings ? C.blue : C.border}`,
            background: C.field,
            color: showSettings ? C.blue : C.textDim,
            borderRadius: 8,
            padding: '4px 8px',
            fontSize: 12,
            cursor: 'pointer',
            flexShrink: 0
          }}
        >
          ⚙
        </button>
      </div>

      {/* Панель настроек (скрыта под шестерёнкой) */}
      {showSettings && (
        <div
          style={{
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: 10,
            background: 'rgba(255,255,255,0.02)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Профиль и лимиты оркестрации
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: C.textDim }}>
            профиль
            <select
              value={workflowProfileResult.success ? workflowProfileResult.data : ''}
              onChange={(e) => setEx({ workflowProfile: e.currentTarget.value })}
              disabled={running}
              style={{
                flex: 1,
                minWidth: 170,
                border: `1px solid ${C.border}`,
                background: C.field,
                color: C.text,
                borderRadius: 7,
                padding: '4px 7px',
                fontSize: 11,
                cursor: running ? 'not-allowed' : 'pointer',
                opacity: running ? 0.65 : 1
              }}
            >
              {!workflowProfileResult.success && <option value="">Некорректное значение</option>}
              <option value="generic">Обычный</option>
              <option value="materials_rnd">Материаловедческий</option>
            </select>
          </label>
          {workflowProfileResult.success && workflowProfileResult.data === 'materials_rnd' && (
            <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.35 }}>
              Пока профиль только маркирует запуск; отдельный материаловедческий маршрут подключается следующим этапом.
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: C.textDim }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              токены
              <input
                type="number"
                value={budgetLimit}
                onChange={(e) => setEx({ project_token_budget: Number(e.currentTarget.value) || 0 })}
                style={numStyle}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              глубина
              <input
                type="number"
                value={maxDepth}
                onChange={(e) => setEx({ max_recursion_depth: Number(e.currentTarget.value) || 1 })}
                style={{ ...numStyle, width: 48 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              итер.
              <input
                type="number"
                value={maxIter}
                onChange={(e) => setEx({ max_iterations_per_mode: Number(e.currentTarget.value) || 1 })}
                style={{ ...numStyle, width: 48 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              паралл.
              <input
                type="number"
                value={maxParallel}
                onChange={(e) => setEx({ max_parallel_nodes: Number(e.currentTarget.value) || 1 })}
                style={{ ...numStyle, width: 48 }}
              />
            </label>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.textDim, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={overlayOn}
              onChange={(e) => setEx({ canvasOverlay: e.currentTarget.checked })}
            />
            🗺 Раскладывать подзадачи нодами на холсте
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.textDim, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoBuild}
              onChange={(e) => setEx({ autoBuild: e.currentTarget.checked })}
            />
            🛠 Авто-строить ноды из результата (ноутбук/канбан/заполнение)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.textDim, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!(ex as { sci?: boolean }).sci}
              onChange={(e) => setEx({ sci: e.currentTarget.checked })}
            />
            🔬 Научный поиск статей (подтягивать в материалы)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.textDim, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!(ex as { sciToKb?: boolean }).sciToKb}
              onChange={(e) => setEx({ sciToKb: e.currentTarget.checked })}
            />
            📚 Скачивать найденные статьи в AnythingLLM (базу знаний)
          </label>

          {/* Модели под-агентов (ролей). Пусто = модель по умолчанию. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              marginTop: 2,
              borderTop: '1px solid var(--border)',
              paddingTop: 8
            }}
          >
            <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Модели под-агентов
            </div>
            {roleModels
              .filter((r) => r.type !== 'planner')
              .map((r) => {
                const cur = r.model === regDefault ? '__default__' : r.model
                return (
                  <label key={r.node_id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.textDim }}>
                    <span style={{ width: 104, flex: 'none' }}>{ORCH_ROLE_LABEL[r.type] || r.type}</span>
                    <select
                      className="flow-input"
                      value={cur}
                      onChange={(e) =>
                        setRoleModel(r.node_id, e.currentTarget.value === '__default__' ? '' : e.currentTarget.value)
                      }
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 11,
                        background: 'var(--panel2)',
                        color: 'var(--text)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '3px 6px',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="__default__">— по умолчанию —</option>
                      {Array.from(new Set(modelOpts.map((m) => m.group))).map((g) => (
                        <optgroup key={g} label={g}>
                          {modelOpts
                            .filter((m) => m.group === g)
                            .map((m) => (
                              <option key={m.value} value={m.value}>
                                {m.label}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                )
              })}
            <div style={{ fontSize: 10, color: C.textDim }}>
              Планировщик берёт модель самой ноды (поле «модель» сверху).
            </div>
          </div>

          <button
            onClick={() =>
              setEx({
                project_token_budget: 1000000,
                max_recursion_depth: 2,
                max_iterations_per_mode: 3,
                max_parallel_nodes: 4
              })
            }
            style={{ ...smallBtn(C.blue), flex: 'none', alignSelf: 'flex-start', padding: '3px 10px' }}
          >
            ↺ Сбросить на максимум
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className="flow-run-btn"
          onClick={running ? cancel : start}
          style={{
            flex: 1,
            cursor: 'pointer',
            border: 'none',
            borderRadius: 10,
            padding: '8px 10px',
            fontSize: 13,
            fontWeight: 600,
            color: '#0E0F12',
            background: running ? '#F87171' : KINDS.orchestrator.grad
          }}
        >
          {running ? '■ Стоп' : '▶ Запустить оркестрацию'}
        </button>
        {(tasks.length > 0 || traces.length > 0) && (
          <button
            onClick={copyThoughts}
            title="Скопировать мысли оркестратора (задачи + трейс + итог)"
            style={{
              flex: 'none',
              cursor: 'pointer',
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: '8px 11px',
              fontSize: 12,
              color: copied ? '#4ADE80' : C.text,
              background: C.field
            }}
          >
            {copied ? '✓' : '📋 Мысли'}
          </button>
        )}
      </div>

      {!running && tasks.length > 0 && (
        <button
          onClick={buildFromResult}
          disabled={building}
          title="Собрать результат нодами на холсте: создать ноутбук/канбан/заметки и заполнить подключённые ноды"
          style={{
            cursor: building ? 'default' : 'pointer',
            border: `1px solid #A78BFA`,
            borderRadius: 10,
            padding: '7px 10px',
            fontSize: 12,
            fontWeight: 600,
            color: building ? C.textDim : '#c4b5fd',
            background: 'rgba(167,139,250,0.10)'
          }}
        >
          {building ? '🛠 Строю ноды…' : '🛠 Построить ноды из результата'}
        </button>
      )}

      {/* Бар бюджета */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: C.textDim, marginBottom: 3 }}>
          <span>бюджет</span>
          <span>
            {spent.toLocaleString('ru')} / {budgetLimit.toLocaleString('ru')} ток. ({Math.round(frac * 100)}%)
          </span>
        </div>
        <div style={{ height: 6, background: C.field, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${frac * 100}%`, height: '100%', background: barColor, transition: 'width .3s' }} />
        </div>
      </div>

      {/* Human-in-the-loop */}
      {humans.map((req) => (
        <div
          key={req.request_id}
          style={{
            border: `1px solid #A78BFA`,
            borderRadius: 10,
            padding: 8,
            background: 'rgba(167,139,250,0.08)',
            fontSize: 11.5
          }}
        >
          <div style={{ color: '#A78BFA', fontWeight: 600, marginBottom: 3 }}>
            ✋ Нужно решение · {req.task_id}
          </div>
          <div style={{ color: C.textDim, marginBottom: 6 }}>{req.reason}</div>
          <div style={{ color: C.text, marginBottom: 6, maxHeight: 60, overflow: 'auto' }}>{req.best_summary}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => decide(req, 'approve')} style={smallBtn('#4ADE80')}>
              Принять
            </button>
            <button onClick={() => decide(req, 'reject')} style={smallBtn('#F87171')}>
              Отклонить
            </button>
            <button
              onClick={() => {
                const fb = window.prompt('Что исправить?') || ''
                decide(req, 'edit', fb)
              }}
              style={smallBtn(C.blue)}
            >
              Правка
            </button>
          </div>
        </div>
      ))}

      {/* Дерево подзадач */}
      <div className="flow-scroll" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {tasks.map((t) => {
          const st = statuses[t.id]?.status || 'pending'
          const meta = STATUS_META[st] || STATUS_META.pending
          return (
            <div
              key={t.id}
              style={{
                border: `1px solid ${C.border}`,
                borderLeft: `3px solid ${meta.color}`,
                borderRadius: 8,
                padding: '6px 8px',
                background: C.field
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{t.description}</span>
                <span style={{ fontSize: 10, color: meta.color, whiteSpace: 'nowrap' }}>{meta.label}</span>
              </div>
              <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>
                {MODE_LABEL[statuses[t.id]?.mode || t.mode] || t.mode}
                {t.deps.length ? ` · зависит: ${t.deps.join(', ')}` : ''}
                {t.size === 'large' ? ' · крупная' : ''}
              </div>
            </div>
          )
        })}
        {!tasks.length && (
          <div style={{ fontSize: 11, color: C.textDim, textAlign: 'center', marginTop: 10 }}>
            {running ? 'Планировщик декомпозирует проект…' : 'Опиши проект и запусти оркестрацию.'}
          </div>
        )}
      </div>

      {rootDone && (
        <div style={{ fontSize: 11.5, color: C.text, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
          <b>Итог:</b> {rootDone}
        </div>
      )}

      {/* Лента трейса — «мысли» оркестратора */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            onClick={() => setShowTrace((v) => !v)}
            style={{ fontSize: 10.5, color: C.textDim, cursor: 'pointer', userSelect: 'none' }}
          >
            {showTrace ? '▾' : '▸'} 🧠 мысли · трейс вызовов ({traces.length})
          </span>
          <div style={{ flex: 1 }} />
          {traces.length > 0 && (
            <button
              onClick={copyThoughts}
              title="Скопировать в буфер"
              style={{ border: 'none', background: 'none', color: copied ? '#4ADE80' : C.textDim, cursor: 'pointer', fontSize: 10.5 }}
            >
              {copied ? '✓' : '📋 копировать'}
            </button>
          )}
        </div>
        {showTrace && traces.length > 0 && (
          <div className="flow-scroll" style={{ maxHeight: 220, overflow: 'auto', marginTop: 4 }}>
            {traces.slice(0, 120).map((tr, i) => (
              <div key={i} style={{ fontSize: 10, color: C.textDim, padding: '2px 0', fontFamily: 'monospace', lineHeight: 1.4, borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                <span style={{ color: C.blue }}>{MODE_LABEL[tr.mode] || tr.mode}</span> · {tr.node_id} ·{' '}
                {tr.cost.tokens}ток · {Math.round(tr.duration_ms / 100) / 10}с
                {tr.note ? <div style={{ color: C.text, whiteSpace: 'pre-wrap', opacity: 0.85 }}>{tr.note}</div> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function smallBtn(color: string) {
  return {
    flex: 1,
    border: `1px solid ${color}`,
    background: 'transparent',
    color,
    borderRadius: 8,
    padding: '4px 6px',
    fontSize: 11,
    cursor: 'pointer'
  } as const
}

// Узел подзадачи на холсте (canvas-оверлей дерева вызовов). Read-only: создаётся
// оркестратором, отражает live-статус, позволяет посмотреть контекст/вывод из Vault.
type OTaskExtra = {
  orchProject?: string
  orchMeta?: string
  taskId?: string
  mode?: string
  status?: string
  deps?: string[]
  size?: string
  success?: string
  outputRef?: string
  inputRefs?: string[]
  cost?: { tokens: number; calls: number }
  note?: string
  node_id?: string
  duration?: number
  callIndex?: number
  callCount?: number
}

// Просмотр Vault по ссылкам (вывод/контекст узла). Общий для orchtask и orchcall.
function VaultPeek({ outputRef, inputRefs }: { outputRef?: string; inputRefs?: string[] }) {
  const [view, setView] = useState<'none' | 'output' | 'context'>('none')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)

  const open = async (kind: 'output' | 'context') => {
    if (view === kind) {
      setView('none')
      return
    }
    setView(kind)
    setLoading(true)
    setText('')
    try {
      if (kind === 'output') {
        const r = outputRef ? await window.flow.orchVaultRead({ key: outputRef }) : { ok: false as const, content: null }
        setText((r.ok && r.content) || '(вывод ещё не записан)')
      } else {
        const keys = inputRefs || []
        if (!keys.length) setText('(контекст пуст — без входных ссылок)')
        else {
          const parts: string[] = []
          for (const k of keys) {
            const r = await window.flow.orchVaultRead({ key: k })
            parts.push(`# ${k}\n${(r.ok && r.content) || '(нет)'}`)
          }
          setText(parts.join('\n\n'))
        }
      }
    } catch (e) {
      setText(`Ошибка чтения Vault: ${String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => open('output')} style={smallBtn(view === 'output' ? '#4ADE80' : C.textDim)}>
          👁 вывод
        </button>
        <button onClick={() => open('context')} style={smallBtn(view === 'context' ? C.blue : C.textDim)}>
          🧩 контекст
        </button>
      </div>
      {view !== 'none' && (
        <div
          className="flow-scroll"
          style={{
            flex: 1,
            overflow: 'auto',
            fontSize: 10.5,
            color: C.text,
            background: C.field,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: 6,
            whiteSpace: 'pre-wrap',
            fontFamily: view === 'context' ? 'monospace' : 'inherit'
          }}
        >
          {loading ? '…' : text}
        </div>
      )}
    </>
  )
}

function OrchTaskBody({ shape }: { shape: FlowNodeShape; editor: Editor }) {
  let ex: OTaskExtra = {}
  try {
    ex = JSON.parse(shape.props.extra || '{}')
  } catch {
    /* ignore */
  }
  const status = ex.status || 'pending'
  const meta = STATUS_META[status] || STATUS_META.pending

  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      style={{ display: 'flex', flexDirection: 'column', gap: 5, height: '100%', overflow: 'hidden' }}
    >
      {/* Статус-полоса */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 9, height: 9, borderRadius: 5, background: meta.color, flex: '0 0 auto' }} />
        <span style={{ fontSize: 11, color: meta.color, fontWeight: 600 }}>{meta.label}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: C.textDim }}>
          {MODE_LABEL[ex.mode || ''] || ex.mode}
          {ex.size === 'large' ? ' · крупная' : ''}
        </span>
      </div>

      <div style={{ fontSize: 12, color: C.text, lineHeight: 1.35, maxHeight: 54, overflow: 'auto' }}>
        {shape.props.body}
      </div>

      <div style={{ fontSize: 10, color: C.textDim }}>
        {shape.props.title}
        {ex.deps && ex.deps.length ? ` · ← ${ex.deps.join(', ')}` : ' · вход'}
        {ex.cost ? ` · ${ex.cost.tokens}ток/${ex.cost.calls}выз` : ''}
        {ex.callCount ? ` · ${ex.callCount} вызовов →` : ''}
      </div>

      <VaultPeek outputRef={ex.outputRef} inputRefs={ex.inputRefs} />
    </div>
  )
}

// Нода отдельного вызова роли (actor/critic/мнение совета/кандидат/делегация).
function OrchCallBody({ shape }: { shape: FlowNodeShape }) {
  let ex: OTaskExtra = {}
  try {
    ex = JSON.parse(shape.props.extra || '{}')
  } catch {
    /* ignore */
  }
  const dur = ex.duration ? `${Math.round(ex.duration / 100) / 10}с` : ''
  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, height: '100%', overflow: 'hidden' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: '#38BDF8', flex: '0 0 auto' }} />
        <span style={{ fontSize: 11, color: C.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ex.node_id || shape.props.title}
        </span>
      </div>
      <div style={{ fontSize: 10, color: '#38BDF8' }}>
        {MODE_LABEL[ex.mode || ''] || ex.mode}
        {ex.cost ? ` · ${ex.cost.tokens}ток` : ''}
        {dur ? ` · ${dur}` : ''}
      </div>
      {(ex.note || shape.props.body) && (
        <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.3, maxHeight: 34, overflow: 'auto' }}>
          {ex.note || shape.props.body}
        </div>
      )}
      <VaultPeek outputRef={ex.outputRef} inputRefs={ex.inputRefs} />
    </div>
  )
}

// ================= Нода «Список»: ввод → ИИ по категориям → цветные плашки =========
type ListGroup = { name: string; items: string[] }
type ListData = { title: string; groups: ListGroup[] }
// Палитра категорий — сочные тона, красиво ложатся полупрозрачными плашками на тёмную тему.
const GROUP_HUES = ['#F59E0B', '#F472B6', '#22D3EE', '#4ADE80', '#A78BFA', '#34D399', '#FB923C', '#60A5FA', '#F87171', '#2DD4BF', '#E879F9', '#FBBF24']

function parseListJson(text: string): ListData | null {
  try {
    const m = text.match(/\{[\s\S]*\}/)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = JSON.parse(m ? m[0] : text)
    const groups: ListGroup[] = (Array.isArray(raw.groups) ? raw.groups : []).map((g: any) => ({
      name: String(g?.name ?? ''),
      items: (Array.isArray(g?.items) ? g.items : []).map((x: any) => String(x)).filter(Boolean)
    }))
    if (!groups.length) return null
    return { title: String(raw.title ?? 'Список'), groups }
  } catch {
    return null
  }
}

function readList(extra: string): ListData {
  try {
    const d = JSON.parse(extra || '{}').list
    if (d && Array.isArray(d.groups)) return d as ListData
  } catch {
    /* ignore */
  }
  return { title: '', groups: [] }
}

function spawnListCard(editor: Editor, sourceId: string, data: ListData): void {
  const bounds = editor.getShapePageBounds(sourceId as never)
  if (!bounds) return
  const id = createShapeId()
  editor.createShape<FlowNodeShape>({
    id,
    type: 'flow-node',
    x: bounds.x,
    y: bounds.maxY + 70,
    props: { kind: 'listcard', title: data.title || 'Список', body: '', extra: JSON.stringify({ list: data }), sourceId, w: 940, h: 520 }
  })
  editor.updateShape<FlowNodeShape>({ id: sourceId as never, type: 'flow-node', props: { answerId: id } })
  connectArrow(editor, sourceId, id)
  editor.select(id)
}

// ---------- Канбан-доска: колонки + карточки-задачи, перенос между колонками ----------
type KanbanCard = { id: string; text: string; done?: boolean }
type KanbanColumn = { id: string; name: string; color: string; limit?: number; cards: KanbanCard[] }
type KanbanData = { columns: KanbanColumn[] }

// Короткий уникальный id для карточек/колонок (в renderer доступен crypto/Math.random)
function kbId(): string {
  try {
    return crypto.randomUUID().slice(0, 8)
  } catch {
    return Math.random().toString(36).slice(2, 10)
  }
}

// Стабильные id дефолтных колонок — чтобы пустая доска не пересобирала колонки
// (и не сбрасывала фокус) на каждом ре-рендере до первого сохранения в props.
function defaultKanban(): KanbanData {
  return {
    columns: [
      { id: 'todo', name: '📋 Нужно сделать', color: '#F59E0B', cards: [] },
      { id: 'doing', name: '🟦 В процессе', color: '#60A5FA', limit: 3, cards: [] },
      { id: 'done', name: '✅ Сделанные', color: '#4ADE80', cards: [] },
      { id: 'moved', name: '↪️ Перенесено', color: '#A78BFA', cards: [] },
      { id: 'cancel', name: '❌ Отменено', color: '#F87171', cards: [] }
    ]
  }
}

function readKanban(extra: string): KanbanData {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = JSON.parse(extra || '{}').kanban as any
    if (d && Array.isArray(d.columns) && d.columns.length) {
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        columns: d.columns.map((c: any) => ({
          id: String(c?.id ?? kbId()),
          name: String(c?.name ?? ''),
          color: String(c?.color ?? '#8B93A3'),
          limit: typeof c?.limit === 'number' ? c.limit : undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cards: (Array.isArray(c?.cards) ? c.cards : []).map((k: any) => ({
            id: String(k?.id ?? kbId()),
            text: String(k?.text ?? ''),
            done: !!k?.done
          }))
        }))
      }
    }
  } catch {
    /* ignore */
  }
  return defaultKanban()
}

// Доска → читаемый текст (передаётся в ИИ по гибкой стрелке-связи).
function kanbanToText(data: KanbanData): string {
  return data.columns
    .map((c) => {
      const head = `${c.name} (${c.cards.length}${c.limit ? `/${c.limit}` : ''})`
      const items = c.cards.length
        ? c.cards.map((k) => `  - [${k.done ? 'x' : ' '}] ${k.text}`).join('\n')
        : '  (пусто)'
      return `${head}:\n${items}`
    })
    .join('\n\n')
}

// Авторастущее поле ввода текста карточки.
function KanbanCardText({
  value,
  onChange,
  onDone,
  autoFocus
}: {
  value: string
  onChange: (v: string) => void
  onDone: () => void
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }
  useEffect(() => {
    grow(ref.current)
    if (autoFocus && ref.current) {
      ref.current.focus()
      const n = ref.current.value.length
      ref.current.setSelectionRange(n, n)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <textarea
      ref={ref}
      value={value}
      draggable={false}
      onPointerDown={stopEventPropagation}
      onInput={(e) => grow(e.currentTarget)}
      onChange={(e) => onChange(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          onDone()
        }
      }}
      onBlur={onDone}
      placeholder="Текст задачи…"
      className="flow-input"
      style={{
        width: '100%',
        resize: 'none',
        border: 'none',
        background: 'transparent',
        color: C.text,
        font: `500 12px ${NODE_SANS}`,
        lineHeight: 1.35,
        padding: 0,
        outline: 'none',
        overflow: 'hidden',
        minHeight: 16
      }}
    />
  )
}

// Тело канбан-ноды: колонки со скроллом, карточки с переносом (drag&drop),
// добавление/переименование/удаление колонок и карточек. Всё живёт в props.extra,
// поэтому работает undo/redo и сохранение доски вместе с холстом.
function KanbanBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  const data = readKanban(shape.props.extra)
  const cols = data.columns
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dragCard, setDragCard] = useState<{ colId: string; cardId: string } | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)

  const save = (next: KanbanColumn[]) => {
    const ex = parseExtra(shape.props.extra)
    update({ extra: JSON.stringify({ ...ex, kanban: { columns: next } }) })
  }
  const mutate = (fn: (cols: KanbanColumn[]) => void) => {
    const next = cols.map((c) => ({ ...c, cards: c.cards.map((k) => ({ ...k })) }))
    fn(next)
    save(next)
  }

  const addCard = (colId: string) => {
    const id = kbId()
    mutate((cs) => {
      const c = cs.find((x) => x.id === colId)
      if (c) c.cards.push({ id, text: '' })
    })
    setEditingId(id)
  }
  const editCard = (cardId: string, text: string) =>
    mutate((cs) => {
      for (const c of cs) {
        const k = c.cards.find((x) => x.id === cardId)
        if (k) k.text = text
      }
    })
  const delCard = (cardId: string) =>
    mutate((cs) => {
      for (const c of cs) c.cards = c.cards.filter((k) => k.id !== cardId)
    })
  const toggleDone = (cardId: string) =>
    mutate((cs) => {
      for (const c of cs) {
        const k = c.cards.find((x) => x.id === cardId)
        if (k) k.done = !k.done
      }
    })
  const moveCard = (fromColId: string, cardId: string, toColId: string, beforeCardId?: string) =>
    mutate((cs) => {
      const from = cs.find((c) => c.id === fromColId)
      const to = cs.find((c) => c.id === toColId)
      if (!from || !to) return
      const idx = from.cards.findIndex((k) => k.id === cardId)
      if (idx < 0) return
      const [card] = from.cards.splice(idx, 1)
      let at = to.cards.length
      if (beforeCardId) {
        const bi = to.cards.findIndex((k) => k.id === beforeCardId)
        if (bi >= 0) at = bi
      }
      to.cards.splice(at, 0, card)
    })

  const addColumn = () =>
    mutate((cs) => {
      cs.push({ id: kbId(), name: 'Новая колонка', color: GROUP_HUES[cs.length % GROUP_HUES.length], cards: [] })
    })
  const renameColumn = (colId: string, name: string) =>
    mutate((cs) => {
      const c = cs.find((x) => x.id === colId)
      if (c) c.name = name
    })
  const delColumn = (colId: string) => {
    const c = cols.find((x) => x.id === colId)
    if (c && c.cards.length && !window.confirm(`Удалить колонку «${c.name}» вместе с ${c.cards.length} карточками?`)) return
    mutate((cs) => {
      const i = cs.findIndex((x) => x.id === colId)
      if (i >= 0) cs.splice(i, 1)
    })
  }

  const onDropTo = (toColId: string, beforeCardId?: string) => {
    if (dragCard) moveCard(dragCard.colId, dragCard.cardId, toColId, beforeCardId)
    setDragCard(null)
    setOverCol(null)
  }

  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      className="flow-scroll"
      style={{ display: 'flex', gap: 12, height: '100%', overflowX: 'auto', overflowY: 'hidden', paddingBottom: 6 }}
    >
      {cols.map((col) => {
        const full = col.limit != null && col.cards.length >= col.limit
        const isOver = overCol === col.id
        return (
          <div
            key={col.id}
            onDragOver={(e) => {
              if (dragCard) {
                e.preventDefault()
                setOverCol(col.id)
              }
            }}
            onDrop={(e) => {
              if (dragCard) {
                e.preventDefault()
                onDropTo(col.id)
              }
            }}
            style={{
              flex: '0 0 236px',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              borderRadius: 12,
              padding: 8,
              background: `color-mix(in srgb, ${col.color} ${isOver ? 16 : 8}%, transparent)`,
              border: `1px solid color-mix(in srgb, ${col.color} ${isOver ? 55 : 22}%, transparent)`,
              transition: 'background .12s, border-color .12s'
            }}
          >
            {/* Заголовок колонки */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.color, flexShrink: 0, boxShadow: `0 0 6px ${col.color}` }} />
              <input
                value={col.name}
                onChange={(e) => renameColumn(col.id, e.currentTarget.value)}
                onPointerDown={stopEventPropagation}
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: 'none',
                  background: 'transparent',
                  color: C.text,
                  font: `700 12px ${NODE_SANS}`,
                  outline: 'none',
                  padding: '2px 0'
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: full ? '#F87171' : C.textDim,
                  flexShrink: 0
                }}
              >
                {col.cards.length}
                {col.limit != null ? `/${col.limit}` : ''}
              </span>
              <button
                onClick={() => delColumn(col.id)}
                onPointerDown={stopEventPropagation}
                title="Удалить колонку"
                style={{ border: 'none', background: 'none', color: C.textDim, cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0, flexShrink: 0 }}
              >
                ×
              </button>
            </div>

            {/* Карточки */}
            <div className="flow-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {col.cards.map((card) => {
                const editing = editingId === card.id
                return (
                  <div
                    key={card.id}
                    draggable={!editing}
                    onDragStart={(e) => {
                      if (editing) return
                      setDragCard({ colId: col.id, cardId: card.id })
                      e.dataTransfer.effectAllowed = 'move'
                      try {
                        e.dataTransfer.setData('text/plain', card.text)
                      } catch {
                        /* ignore */
                      }
                    }}
                    onDragEnd={() => {
                      setDragCard(null)
                      setOverCol(null)
                    }}
                    onDragOver={(e) => {
                      if (dragCard && dragCard.cardId !== card.id) {
                        e.preventDefault()
                        e.stopPropagation()
                        setOverCol(col.id)
                      }
                    }}
                    onDrop={(e) => {
                      if (dragCard && dragCard.cardId !== card.id) {
                        e.preventDefault()
                        e.stopPropagation()
                        onDropTo(col.id, card.id)
                      }
                    }}
                    onDoubleClick={() => setEditingId(card.id)}
                    className="flow-kanban-card"
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 7,
                      padding: '8px 9px',
                      borderRadius: 9,
                      background: 'var(--panel)',
                      border: `1px solid ${dragCard?.cardId === card.id ? `color-mix(in srgb, ${col.color} 60%, transparent)` : 'var(--border)'}`,
                      boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                      cursor: editing ? 'text' : 'grab',
                      opacity: dragCard?.cardId === card.id ? 0.5 : 1
                    }}
                  >
                    <button
                      onClick={() => toggleDone(card.id)}
                      onPointerDown={stopEventPropagation}
                      title={card.done ? 'Снять отметку' : 'Отметить сделанным'}
                      style={{
                        flexShrink: 0,
                        marginTop: 1,
                        width: 15,
                        height: 15,
                        borderRadius: 4,
                        border: `1.5px solid ${card.done ? col.color : 'var(--border)'}`,
                        background: card.done ? col.color : 'transparent',
                        color: '#0d1117',
                        cursor: 'pointer',
                        fontSize: 10,
                        lineHeight: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      {card.done ? '✓' : ''}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {editing ? (
                        <KanbanCardText
                          value={card.text}
                          autoFocus
                          onChange={(v) => editCard(card.id, v)}
                          onDone={() => {
                            if (!card.text.trim()) delCard(card.id)
                            setEditingId(null)
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            font: `500 12px ${NODE_SANS}`,
                            color: card.done ? C.textDim : C.text,
                            textDecoration: card.done ? 'line-through' : 'none',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            lineHeight: 1.35
                          }}
                        >
                          {card.text || '…'}
                        </span>
                      )}
                    </div>
                    {!editing && (
                      <button
                        className="flow-kanban-del"
                        onClick={() => delCard(card.id)}
                        onPointerDown={stopEventPropagation}
                        title="Удалить"
                        style={{
                          flexShrink: 0,
                          border: 'none',
                          background: 'none',
                          color: C.textDim,
                          cursor: 'pointer',
                          fontSize: 13,
                          lineHeight: 1,
                          padding: 0
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Добавить карточку */}
            <button
              onClick={() => addCard(col.id)}
              onPointerDown={stopEventPropagation}
              style={{
                marginTop: 6,
                border: `1px dashed color-mix(in srgb, ${col.color} 40%, var(--border))`,
                background: 'transparent',
                color: C.textDim,
                borderRadius: 8,
                padding: '6px',
                fontSize: 11.5,
                cursor: 'pointer',
                fontFamily: NODE_SANS
              }}
            >
              + Добавить карточку
            </button>
          </div>
        )
      })}

      {/* Добавить колонку */}
      <button
        onClick={addColumn}
        onPointerDown={stopEventPropagation}
        style={{
          flex: '0 0 46px',
          alignSelf: 'stretch',
          border: '1px dashed var(--border)',
          background: 'transparent',
          color: C.textDim,
          borderRadius: 12,
          cursor: 'pointer',
          fontSize: 20,
          fontFamily: NODE_SANS
        }}
        title="Добавить колонку"
      >
        +
      </button>
    </div>
  )
}

// ---------- Большой мультиканбан-фрейм: несколько досок, ИИ-исполнитель ----------
// Одна нода = целый бэклог: сколько угодно именованных досок (подтем), у каждой —
// свои колонки и карточки-задачи. Карточки перетаскиваются между любыми колонками
// любых досок. У каждой задачи есть кнопка «сделать через ИИ».
type BoardCard = { id: string; text: string; done?: boolean; result?: string }
type BoardColumn = { id: string; name: string; cards: BoardCard[] }
type Board = { id: string; name: string; color: string; columns: BoardColumn[] }
type BoardData = { boards: Board[] }

const BOARD_HUES = ['#4ADE80', '#60A5FA', '#FB923C', '#A78BFA', '#F472B6', '#22D3EE', '#F59E0B', '#34D399', '#F87171', '#E879F9']

function defaultBoard(): BoardData {
  return {
    boards: [
      {
        id: kbId(),
        name: 'Новая доска',
        color: BOARD_HUES[0],
        columns: [
          { id: kbId(), name: 'Идеи', cards: [] },
          { id: kbId(), name: 'В работе', cards: [] },
          { id: kbId(), name: 'Готово', cards: [] }
        ]
      }
    ]
  }
}

function readBoard(extra: string): BoardData {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = JSON.parse(extra || '{}').board as any
    if (d && Array.isArray(d.boards) && d.boards.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        boards: d.boards.map((b: any, bi: number) => ({
          id: String(b?.id ?? kbId()),
          name: String(b?.name ?? ''),
          color: String(b?.color ?? BOARD_HUES[bi % BOARD_HUES.length]),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns: (Array.isArray(b?.columns) ? b.columns : []).map((c: any) => ({
            id: String(c?.id ?? kbId()),
            name: String(c?.name ?? ''),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cards: (Array.isArray(c?.cards) ? c.cards : []).map((k: any) => ({
              id: String(k?.id ?? kbId()),
              text: String(k?.text ?? ''),
              done: !!k?.done,
              result: k?.result ? String(k.result) : undefined
            }))
          }))
        }))
      }
    }
  } catch {
    /* ignore */
  }
  return defaultBoard()
}

// Весь фрейм → текст (передаётся в связанный ИИ-чат по гибкой стрелке).
function boardToText(data: BoardData): string {
  return data.boards
    .map((b) => {
      const cols = b.columns
        .map((c) => {
          const items = c.cards.length ? c.cards.map((k) => `    - [${k.done ? 'x' : ' '}] ${k.text}`).join('\n') : '    (пусто)'
          return `  ${c.name}:\n${items}`
        })
        .join('\n')
      return `Доска «${b.name}»:\n${cols}`
    })
    .join('\n\n')
}

function BoardBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  const data = readBoard(shape.props.extra)
  const boards = data.boards
  const model = shape.props.model
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dragCard, setDragCard] = useState<{ colId: string; cardId: string } | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const [running, setRunning] = useState<string[]>([])
  const [expanded, setExpanded] = useState<string[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatOpen, setChatOpen] = useState(true)
  const history: ChatMessage[] = (() => {
    try {
      return JSON.parse(shape.props.history || '[]')
    } catch {
      return []
    }
  })()

  const sendChat = async () => {
    const q = chatInput.trim()
    if (!q || chatSending) return
    setChatInput('')
    setChatSending(true)
    const sys =
      'Ты — ассистент внутри канбан-бэклога. Помогаешь планировать, формулировать и выполнять задачи с досок. ' +
      'Отвечай кратко и по делу, на русском, в Markdown.\n\nТекущее состояние досок:\n' +
      boardToText(readBoard(shape.props.extra))
    const ctx = gatherChatContext(editor, String(shape.id), ORCH_SKIP_KINDS)
    const sysFull = ctx.length ? `${sys}\n\nСвязанные с бэклогом ноды:\n${ctx.join('\n\n').slice(0, 5000)}` : sys
    const next: ChatMessage[] = [...history, { role: 'user', content: q }]
    update({ history: JSON.stringify(next) })
    try {
      const res = await window.flow.aiChat({ model, messages: [{ role: 'system', content: sysFull }, ...next.slice(-10)] })
      const answer = res.ok ? res.content : '⚠ ' + (res.error || 'ошибка ИИ')
      update({ history: JSON.stringify([...next, { role: 'assistant', content: answer }]) })
    } catch (e) {
      update({ history: JSON.stringify([...next, { role: 'assistant', content: '⚠ ' + String(e) }]) })
    } finally {
      setChatSending(false)
    }
  }
  const clearChat = () => update({ history: '[]' })

  const save = (next: Board[]) => {
    const ex = parseExtra(shape.props.extra)
    update({ extra: JSON.stringify({ ...ex, board: { boards: next } }) })
  }
  const mutate = (fn: (bs: Board[]) => void) => {
    const next = boards.map((b) => ({
      ...b,
      columns: b.columns.map((c) => ({ ...c, cards: c.cards.map((k) => ({ ...k })) }))
    }))
    fn(next)
    save(next)
  }
  const eachCard = (bs: Board[], cardId: string, fn: (k: BoardCard, c: BoardColumn, b: Board) => void) => {
    for (const b of bs) for (const c of b.columns) { const k = c.cards.find((x) => x.id === cardId); if (k) fn(k, c, b) }
  }

  const addCard = (colId: string) => {
    const id = kbId()
    mutate((bs) => {
      for (const b of bs) { const c = b.columns.find((x) => x.id === colId); if (c) c.cards.push({ id, text: '' }) }
    })
    setEditingId(id)
  }
  const editCard = (cardId: string, text: string) => mutate((bs) => eachCard(bs, cardId, (k) => { k.text = text }))
  const delCard = (cardId: string) => mutate((bs) => { for (const b of bs) for (const c of b.columns) c.cards = c.cards.filter((k) => k.id !== cardId) })
  const toggleDone = (cardId: string) => mutate((bs) => eachCard(bs, cardId, (k) => { k.done = !k.done }))
  const moveCard = (fromColId: string, cardId: string, toColId: string, beforeCardId?: string) =>
    mutate((bs) => {
      let from: BoardColumn | undefined
      let to: BoardColumn | undefined
      for (const b of bs) for (const c of b.columns) { if (c.id === fromColId) from = c; if (c.id === toColId) to = c }
      if (!from || !to) return
      const idx = from.cards.findIndex((k) => k.id === cardId)
      if (idx < 0) return
      const [card] = from.cards.splice(idx, 1)
      let at = to.cards.length
      if (beforeCardId) { const bi = to.cards.findIndex((k) => k.id === beforeCardId); if (bi >= 0) at = bi }
      to.cards.splice(at, 0, card)
    })
  const onDropTo = (toColId: string, beforeCardId?: string) => {
    if (dragCard) moveCard(dragCard.colId, dragCard.cardId, toColId, beforeCardId)
    setDragCard(null)
    setOverCol(null)
  }

  const addColumn = (boardId: string) => mutate((bs) => { const b = bs.find((x) => x.id === boardId); if (b) b.columns.push({ id: kbId(), name: 'Колонка', cards: [] }) })
  const renameColumn = (colId: string, name: string) => mutate((bs) => { for (const b of bs) { const c = b.columns.find((x) => x.id === colId); if (c) c.name = name } })
  const delColumn = (colId: string) => {
    let cards = 0
    for (const b of boards) { const c = b.columns.find((x) => x.id === colId); if (c) cards = c.cards.length }
    if (cards && !window.confirm(`Удалить колонку вместе с ${cards} карточками?`)) return
    mutate((bs) => { for (const b of bs) b.columns = b.columns.filter((c) => c.id !== colId) })
  }
  const addBoard = () => mutate((bs) => {
    bs.push({ id: kbId(), name: 'Новая доска', color: BOARD_HUES[bs.length % BOARD_HUES.length], columns: [{ id: kbId(), name: 'Задачи', cards: [] }] })
  })
  const renameBoard = (boardId: string, name: string) => mutate((bs) => { const b = bs.find((x) => x.id === boardId); if (b) b.name = name })
  const delBoard = (boardId: string) => {
    const b = boards.find((x) => x.id === boardId)
    const n = b ? b.columns.reduce((s, c) => s + c.cards.length, 0) : 0
    if (n && !window.confirm(`Удалить доску «${b?.name}» со всеми её задачами (${n})?`)) return
    mutate((bs) => { const i = bs.findIndex((x) => x.id === boardId); if (i >= 0) bs.splice(i, 1) })
  }

  const runAI = async (card: BoardCard, board: Board, col: BoardColumn) => {
    if (running.includes(card.id) || !card.text.trim()) return
    setRunning((r) => [...r, card.id])
    setExpanded((e) => (e.includes(card.id) ? e : [...e, card.id]))
    try {
      const ctx = gatherChatContext(editor, String(shape.id), ORCH_SKIP_KINDS)
      const sys =
        'Ты — исполнитель задач с канбан-доски. Тебе дают ОДНУ задачу — выполни её: дай конкретный результат, ' +
        'решение, план или готовый текст. Не рассуждай о том, как бы ты делал — сразу делай. Пиши по делу, на русском, в Markdown.'
      const user =
        `Доска: «${board.name}»\nКолонка: «${col.name}»\nЗадача: ${card.text}` +
        (ctx.length ? `\n\nДополнительный контекст (связанные с доской ноды):\n${ctx.join('\n\n').slice(0, 6000)}` : '')
      const res = await window.flow.aiChat({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] })
      mutate((bs) => eachCard(bs, card.id, (k) => {
        if (res.ok) { k.result = res.content; k.done = true }
        else k.result = '⚠ ' + (res.error || 'ошибка ИИ')
      }))
    } catch (e) {
      mutate((bs) => eachCard(bs, card.id, (k) => { k.result = '⚠ ' + String(e) }))
    } finally {
      setRunning((r) => r.filter((x) => x !== card.id))
    }
  }

  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      className="flow-scroll"
      style={{ display: 'flex', flexDirection: 'column', gap: 14, height: '100%', overflowY: 'auto', overflowX: 'hidden', paddingRight: 4 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: C.textDim, whiteSpace: 'nowrap' }}>🤖 Модель-исполнитель:</span>
        <div style={{ flex: 1 }}>
          <ModelSelect value={model} onChange={(v) => update({ model: v })} />
        </div>
      </div>

      {/* Небольшой чат с моделью: видит все доски и связанные ноды */}
      <div style={{ flexShrink: 0, border: '1px solid var(--border)', borderRadius: 10, background: 'color-mix(in srgb, var(--panel2) 55%, transparent)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer' }} onClick={() => setChatOpen((v) => !v)}>
          <span style={{ font: `600 11px ${NODE_MONO}`, color: C.text, letterSpacing: '.02em' }}>💬 Чат с моделью</span>
          {history.length > 0 && <span style={{ fontSize: 10, color: C.textDim }}>{Math.floor(history.length / 2)} реплик</span>}
          <div style={{ flex: 1 }} />
          {history.length > 0 && (
            <button onClick={(e) => { stopEventPropagation(e); clearChat() }} onPointerDown={stopEventPropagation} title="Очистить чат" style={{ border: 'none', background: 'none', color: C.textDim, cursor: 'pointer', fontSize: 11 }}>очистить</button>
          )}
          <span style={{ color: C.textDim, fontSize: 11 }}>{chatOpen ? '▾' : '▸'}</span>
        </div>
        {chatOpen && (
          <div style={{ borderTop: '1px solid var(--border)', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.filter((m) => m.role !== 'system').length > 0 && (
              <div className="flow-scroll" style={{ maxHeight: 170, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.filter((m) => m.role !== 'system').map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <div
                      style={{
                        maxWidth: '85%',
                        padding: '6px 9px',
                        borderRadius: 9,
                        fontSize: 12,
                        lineHeight: 1.4,
                        background: m.role === 'user' ? 'color-mix(in srgb, var(--accent) 20%, var(--panel))' : 'var(--panel)',
                        border: '1px solid var(--border)',
                        color: C.text
                      }}
                    >
                      {m.role === 'user' ? <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</span> : <MarkdownView content={m.content} />}
                    </div>
                  </div>
                ))}
                {chatSending && <div style={{ fontSize: 11, color: C.textDim, padding: '2px 4px' }}>Модель печатает…</div>}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.currentTarget.value)}
                onPointerDown={stopEventPropagation}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendChat()
                  }
                }}
                placeholder="Спроси модель о задачах, попроси распланировать…"
                className="flow-input"
                rows={1}
                style={{ ...fieldStyle, flex: 1, resize: 'none', minHeight: 34, maxHeight: 90, lineHeight: 1.35, fontSize: 12 }}
              />
              <button
                onClick={sendChat}
                onPointerDown={stopEventPropagation}
                disabled={chatSending || !chatInput.trim()}
                style={{
                  border: 'none',
                  borderRadius: 9,
                  padding: '8px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: chatSending || !chatInput.trim() ? 'default' : 'pointer',
                  color: '#fff',
                  background: chatSending || !chatInput.trim() ? '#3a3a3c' : 'linear-gradient(180deg,#a5b4fc,#818CF8)',
                  flexShrink: 0
                }}
              >
                {chatSending ? '…' : '↑'}
              </button>
            </div>
          </div>
        )}
      </div>

      {boards.map((board) => (
        <div
          key={board.id}
          style={{
            borderRadius: 14,
            padding: 12,
            background: `color-mix(in srgb, ${board.color} 9%, transparent)`,
            border: `1px solid color-mix(in srgb, ${board.color} 26%, transparent)`
          }}
        >
          {/* Заголовок доски */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 10px',
                borderRadius: 8,
                background: 'var(--panel)',
                border: `1px solid color-mix(in srgb, ${board.color} 45%, var(--border))`
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: board.color, boxShadow: `0 0 6px ${board.color}` }} />
              <input
                value={board.name}
                onChange={(e) => renameBoard(board.id, e.currentTarget.value)}
                onPointerDown={stopEventPropagation}
                style={{ border: 'none', background: 'transparent', color: C.text, font: `700 13px ${NODE_SANS}`, outline: 'none', width: Math.max(90, board.name.length * 8) }}
              />
            </span>
            <span style={{ fontSize: 11, color: C.textDim }}>
              {board.columns.reduce((s, c) => s + c.cards.length, 0)} задач
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={() => delBoard(board.id)} onPointerDown={stopEventPropagation} title="Удалить доску" style={{ border: 'none', background: 'none', color: C.textDim, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
          </div>

          {/* Колонки доски */}
          <div className="flow-scroll" style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, alignItems: 'flex-start' }}>
            {board.columns.map((col) => {
              const isOver = overCol === col.id
              return (
                <div
                  key={col.id}
                  onDragOver={(e) => { if (dragCard) { e.preventDefault(); setOverCol(col.id) } }}
                  onDrop={(e) => { if (dragCard) { e.preventDefault(); onDropTo(col.id) } }}
                  style={{
                    flex: '0 0 172px',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 10,
                    padding: 7,
                    background: isOver ? `color-mix(in srgb, ${board.color} 14%, var(--panel))` : 'color-mix(in srgb, var(--panel) 70%, transparent)',
                    border: `1px solid ${isOver ? `color-mix(in srgb, ${board.color} 55%, transparent)` : 'var(--border)'}`,
                    transition: 'background .12s, border-color .12s'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                    <input
                      value={col.name}
                      onChange={(e) => renameColumn(col.id, e.currentTarget.value)}
                      onPointerDown={stopEventPropagation}
                      style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: C.textDim, font: `600 11px ${NODE_MONO}`, letterSpacing: '.02em', outline: 'none', textTransform: 'uppercase' }}
                    />
                    <span style={{ fontSize: 10, color: C.textDim, flexShrink: 0 }}>{col.cards.length}</span>
                    <button onClick={() => delColumn(col.id)} onPointerDown={stopEventPropagation} title="Удалить колонку" style={{ border: 'none', background: 'none', color: C.textDim, cursor: 'pointer', fontSize: 12, lineHeight: 1, flexShrink: 0 }}>×</button>
                  </div>

                  <div className="flow-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {col.cards.map((card) => {
                      const editing = editingId === card.id
                      const busy = running.includes(card.id)
                      const open = expanded.includes(card.id)
                      return (
                        <div
                          key={card.id}
                          draggable={!editing}
                          onDragStart={(e) => { if (editing) return; setDragCard({ colId: col.id, cardId: card.id }); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', card.text) } catch { /* ignore */ } }}
                          onDragEnd={() => { setDragCard(null); setOverCol(null) }}
                          onDragOver={(e) => { if (dragCard && dragCard.cardId !== card.id) { e.preventDefault(); e.stopPropagation(); setOverCol(col.id) } }}
                          onDrop={(e) => { if (dragCard && dragCard.cardId !== card.id) { e.preventDefault(); e.stopPropagation(); onDropTo(col.id, card.id) } }}
                          onDoubleClick={() => setEditingId(card.id)}
                          className="flow-kanban-card"
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            padding: '7px 8px',
                            borderRadius: 8,
                            background: 'var(--panel2)',
                            border: `1px solid ${dragCard?.cardId === card.id ? `color-mix(in srgb, ${board.color} 60%, transparent)` : 'var(--border)'}`,
                            cursor: editing ? 'text' : 'grab',
                            opacity: dragCard?.cardId === card.id ? 0.5 : 1
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <button
                              onClick={() => toggleDone(card.id)}
                              onPointerDown={stopEventPropagation}
                              title={card.done ? 'Снять отметку' : 'Готово'}
                              style={{ flexShrink: 0, marginTop: 1, width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${card.done ? board.color : 'var(--border)'}`, background: card.done ? board.color : 'transparent', color: '#0d1117', cursor: 'pointer', fontSize: 9, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              {card.done ? '✓' : ''}
                            </button>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {editing ? (
                                <KanbanCardText value={card.text} autoFocus onChange={(v) => editCard(card.id, v)} onDone={() => { if (!card.text.trim()) delCard(card.id); setEditingId(null) }} />
                              ) : (
                                <span style={{ font: `500 11.5px ${NODE_SANS}`, color: card.done ? C.textDim : C.text, textDecoration: card.done ? 'line-through' : 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.35 }}>
                                  {card.text || '…'}
                                </span>
                              )}
                            </div>
                          </div>
                          {!editing && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <button
                                onClick={() => runAI(card, board, col)}
                                onPointerDown={stopEventPropagation}
                                disabled={busy}
                                title="Выполнить задачу с помощью ИИ"
                                style={{ border: `1px solid color-mix(in srgb, ${board.color} 40%, var(--border))`, background: 'transparent', color: busy ? C.textDim : board.color, borderRadius: 6, fontSize: 10, padding: '2px 7px', cursor: busy ? 'default' : 'pointer', fontFamily: NODE_SANS, whiteSpace: 'nowrap' }}
                              >
                                {busy ? '⏳ ИИ…' : '🤖 Сделать'}
                              </button>
                              {card.result && (
                                <button onClick={() => setExpanded((ex) => (open ? ex.filter((x) => x !== card.id) : [...ex, card.id]))} onPointerDown={stopEventPropagation} style={{ border: 'none', background: 'none', color: C.textDim, cursor: 'pointer', fontSize: 10 }}>
                                  {open ? '▾ скрыть' : '▸ результат'}
                                </button>
                              )}
                              <div style={{ flex: 1 }} />
                              <button onClick={() => delCard(card.id)} onPointerDown={stopEventPropagation} title="Удалить" style={{ border: 'none', background: 'none', color: C.textDim, cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>×</button>
                            </div>
                          )}
                          {card.result && open && !editing && (
                            <div onPointerDown={stopEventPropagation} onWheelCapture={stopEventPropagation} style={{ maxHeight: 180, overflow: 'auto', borderTop: `1px solid var(--border)`, paddingTop: 6, fontSize: 11 }} className="flow-scroll">
                              <MarkdownView content={card.result} />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  <button
                    onClick={() => addCard(col.id)}
                    onPointerDown={stopEventPropagation}
                    style={{ marginTop: 6, border: `1px dashed color-mix(in srgb, ${board.color} 35%, var(--border))`, background: 'transparent', color: C.textDim, borderRadius: 7, padding: '5px', fontSize: 11, cursor: 'pointer', fontFamily: NODE_SANS }}
                  >
                    + Задача
                  </button>
                </div>
              )
            })}

            {/* Добавить колонку в доску */}
            <button onClick={() => addColumn(board.id)} onPointerDown={stopEventPropagation} title="Добавить колонку" style={{ flex: '0 0 40px', alignSelf: 'stretch', minHeight: 60, border: '1px dashed var(--border)', background: 'transparent', color: C.textDim, borderRadius: 10, cursor: 'pointer', fontSize: 18, fontFamily: NODE_SANS }}>+</button>
          </div>
        </div>
      ))}

      {/* Добавить доску */}
      <button
        onClick={addBoard}
        onPointerDown={stopEventPropagation}
        style={{ flexShrink: 0, border: '1px dashed var(--border)', background: 'transparent', color: C.textDim, borderRadius: 12, padding: '10px', fontSize: 12.5, cursor: 'pointer', fontFamily: NODE_SANS }}
      >
        + Добавить доску
      </button>
    </div>
  )
}

function ListBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  const { model } = shape.props
  const ex = parseExtra(shape.props.extra)
  const content = ex.content ?? ''
  const cats = ex.cats ?? ''
  const setEx = (patch: Record<string, string>) => update({ extra: JSON.stringify({ ...ex, ...patch }) })
  const [gen, setGen] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const apply = async () => {
    if (!content.trim() || gen) return
    setGen(true)
    setStatus('🗂 Раскладываю по категориям…')
    try {
      const sys =
        'Ты раскладываешь элементы в аккуратный структурированный список по категориям. ' +
        'Верни ТОЛЬКО валидный JSON без markdown-ограждений в формате ' +
        '{"title": "краткое название списка", "groups": [{"name": "Категория", "items": ["пункт", "пункт"]}]}. ' +
        'Пункты — короткие строки. Если пользователь задал желаемые категории — используй их; иначе придумай логичные. На русском.'
      const res = await window.flow.aiChat({
        model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: `Что нужно в списке: ${content}\nЖелаемые категории: ${cats || '(придумай сам)'}` }
        ]
      })
      if (res.ok) {
        const data = parseListJson(res.content)
        if (data) {
          spawnListCard(editor, String(shape.id), data)
          setStatus('Готово ✓')
        } else setStatus('Не удалось разобрать ответ модели')
      } else setStatus(res.error)
    } catch (e) {
      setStatus(String(e))
    } finally {
      setGen(false)
    }
  }

  return (
    <div onPointerDown={stopEventPropagation} onWheelCapture={stopEventPropagation} style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <ModelSelect value={model} onChange={(v) => update({ model: v })} />
      <label style={{ fontSize: 11, color: C.textDim }}>Содержание списка</label>
      <textarea
        className="flow-input"
        value={content}
        onChange={(e) => setEx({ content: e.currentTarget.value })}
        placeholder="Что должно быть в списке…"
        style={{ ...fieldStyle, minHeight: 60, maxHeight: 110, resize: 'none', lineHeight: 1.4 }}
      />
      <label style={{ fontSize: 11, color: C.textDim }}>Категории (опционально)</label>
      <textarea
        className="flow-input"
        value={cats}
        onChange={(e) => setEx({ cats: e.currentTarget.value })}
        placeholder="Какие категории должны быть — или оставь пустым"
        style={{ ...fieldStyle, minHeight: 40, maxHeight: 70, resize: 'none', lineHeight: 1.4 }}
      />
      <button
        onClick={apply}
        disabled={gen}
        style={{
          cursor: gen ? 'default' : 'pointer',
          border: 'none',
          borderRadius: 10,
          padding: '8px',
          fontSize: 12.5,
          fontWeight: 600,
          color: '#3a2500',
          background: gen ? '#3a3a3c' : 'linear-gradient(180deg,#fbbf5a,#F59E0B)',
          boxShadow: gen ? 'none' : '0 2px 8px rgba(245,158,11,0.3)'
        }}
      >
        {gen ? '🗂 Раскладываю…' : '🗂 Применить'}
      </button>
      {status && <div style={{ fontSize: 11, color: C.textDim }}>{status}</div>}
    </div>
  )
}

// Плашки-колонки результата. Редактируемые: правка/добавление/удаление пунктов и колонок.
function ListCardBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  const update = useUpdate(editor, shape)
  const data = readList(shape.props.extra)
  const save = (next: ListData) => {
    const ex = (() => {
      try {
        return JSON.parse(shape.props.extra || '{}')
      } catch {
        return {}
      }
    })()
    update({ extra: JSON.stringify({ ...ex, list: next }), title: next.title || shape.props.title })
  }
  const editGroups = (fn: (g: ListGroup[]) => ListGroup[]) => save({ ...data, groups: fn(data.groups.map((g) => ({ ...g, items: [...g.items] }))) })

  if (!data.groups.length) {
    return <div style={{ fontSize: 12, color: C.textDim, padding: 8 }}>Пустой список.</div>
  }

  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      className="flow-scroll"
      style={{ display: 'flex', gap: 12, height: '100%', overflowX: 'auto', overflowY: 'hidden', paddingBottom: 6 }}
    >
      {data.groups.map((g, gi) => {
        const hue = GROUP_HUES[gi % GROUP_HUES.length]
        return (
          <div
            key={gi}
            style={{
              flex: '0 0 190px',
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
              minHeight: 0,
              borderRadius: 12,
              padding: 8,
              background: `color-mix(in srgb, ${hue} 8%, transparent)`,
              border: `1px solid color-mix(in srgb, ${hue} 22%, transparent)`
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                value={g.name}
                onChange={(e) => editGroups((gs) => (gs[gi].name = e.currentTarget.value, gs))}
                placeholder="Категория"
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: hue,
                  font: `600 12px ${NODE_SANS}`
                }}
              />
              <button
                title="Удалить колонку"
                onClick={() => editGroups((gs) => gs.filter((_, i) => i !== gi))}
                style={{ border: 'none', background: 'transparent', color: C.textDim, cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
              >
                ×
              </button>
            </div>
            <div className="flow-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flex: 1 }}>
              {g.items.map((it, ii) => (
                <div
                  key={ii}
                  className="flow-chip-card"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 4,
                    borderRadius: 9,
                    padding: '6px 8px',
                    background: `color-mix(in srgb, ${hue} 13%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${hue} 20%, transparent)`
                  }}
                >
                  <textarea
                    value={it}
                    rows={1}
                    onChange={(e) => editGroups((gs) => (gs[gi].items[ii] = e.currentTarget.value, gs))}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      resize: 'none',
                      color: C.text,
                      font: `400 12px ${NODE_SANS}`,
                      lineHeight: 1.35
                    }}
                  />
                  <button
                    onClick={() => editGroups((gs) => (gs[gi].items = gs[gi].items.filter((_, i) => i !== ii), gs))}
                    style={{ border: 'none', background: 'transparent', color: C.textDim, cursor: 'pointer', fontSize: 12, lineHeight: 1, opacity: 0.6 }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={() => editGroups((gs) => (gs[gi].items.push(''), gs))}
                style={{ border: `1px dashed color-mix(in srgb, ${hue} 30%, transparent)`, background: 'transparent', color: hue, borderRadius: 8, padding: '4px', fontSize: 11, cursor: 'pointer' }}
              >
                + пункт
              </button>
            </div>
          </div>
        )
      })}
      <button
        onClick={() => editGroups((gs) => [...gs, { name: 'Новая категория', items: [] }])}
        style={{ flex: '0 0 auto', alignSelf: 'flex-start', border: `1px dashed ${C.border}`, background: 'transparent', color: C.textDim, borderRadius: 10, padding: '8px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        + колонка
      </button>
    </div>
  )
}

// ================= Нода «Таблица» (Excel): сетка + формулы + экспорт .xlsx ==========
type SheetModel = {
  rows: number
  cols: number
  cells: Record<string, string>
  colW?: Record<string, number> // ширина столбцов (px) по индексу
  rowH?: Record<string, number> // высота строк (px) по индексу
}
function colName(c: number): string {
  let s = ''
  let n = c + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
function parseRef(ref: string): { r: number; c: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref.trim())
  if (!m) return null
  let c = 0
  for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { c: c - 1, r: parseInt(m[2], 10) - 1 }
}
function readSheet(extra: string): SheetModel {
  try {
    const d = JSON.parse(extra || '{}').sheet
    if (d && typeof d.rows === 'number') return { rows: d.rows, cols: d.cols, cells: d.cells || {}, colW: d.colW || {}, rowH: d.rowH || {} }
  } catch {
    /* ignore */
  }
  return { rows: 6, cols: 5, cells: {} }
}
// Вычислитель ячеек: формулы =…, ссылки A1, диапазоны A1:B3, функции SUM/AVG/MIN/MAX/COUNT.
function makeCompute(model: SheetModel): (r: number, c: number) => number | string {
  const memo = new Map<string, number | string>()
  const inProg = new Set<string>()
  const rawAt = (r: number, c: number): string => model.cells[`${r}:${c}`] ?? ''
  const num = (v: number | string): number => (typeof v === 'number' ? v : Number(String(v).replace(',', '.')) || 0)

  const compute = (r: number, c: number): number | string => {
    const key = `${r}:${c}`
    if (memo.has(key)) return memo.get(key) as number | string
    if (inProg.has(key)) return '#ЦИКЛ'
    inProg.add(key)
    let out: number | string
    const v = rawAt(r, c).trim()
    if (v.startsWith('=')) {
      try {
        out = evalFormula(v.slice(1))
      } catch {
        out = '#ОШ'
      }
    } else if (v !== '' && !isNaN(Number(v.replace(',', '.')))) out = Number(v.replace(',', '.'))
    else out = v
    inProg.delete(key)
    memo.set(key, out)
    return out
  }

  // Рекурсивный разбор арифметики (числа, ссылки, диапазоны, функции, + - * / скобки)
  function evalFormula(src: string): number {
    let i = 0
    const s = src
    const ws = (): void => {
      while (i < s.length && s[i] === ' ') i++
    }
    const rangeValues = (): number[] => {
      // читаем ссылку, возможно диапазон A1:B3
      const start = i
      while (i < s.length && /[A-Za-z0-9]/.test(s[i])) i++
      let a = s.slice(start, i)
      if (s[i] === ':') {
        i++
        const st2 = i
        while (i < s.length && /[A-Za-z0-9]/.test(s[i])) i++
        const b = s.slice(st2, i)
        const ra = parseRef(a)
        const rb = parseRef(b)
        if (!ra || !rb) return []
        const out: number[] = []
        for (let rr = Math.min(ra.r, rb.r); rr <= Math.max(ra.r, rb.r); rr++)
          for (let cc = Math.min(ra.c, rb.c); cc <= Math.max(ra.c, rb.c); cc++) out.push(num(compute(rr, cc)))
        return out
      }
      const ref = parseRef(a)
      return ref ? [num(compute(ref.r, ref.c))] : []
    }
    function factor(): number {
      ws()
      if (s[i] === '(') {
        i++
        const v = expr()
        ws()
        if (s[i] === ')') i++
        return v
      }
      if (s[i] === '-') {
        i++
        return -factor()
      }
      if (s[i] === '+') {
        i++
        return factor()
      }
      // число
      const start = i
      while (i < s.length && /[0-9.,]/.test(s[i])) i++
      if (i > start) return Number(s.slice(start, i).replace(',', '.')) || 0
      // идентификатор: функция или ссылка
      const idStart = i
      while (i < s.length && /[A-Za-z]/.test(s[i])) i++
      const name = s.slice(idStart, i).toUpperCase()
      if (s[i] === '(') {
        i++
        const args: number[] = []
        // аргументы могут быть диапазонами/выражениями через запятую
        ws()
        while (s[i] !== ')' && i < s.length) {
          // если похоже на диапазон/ссылку — берём как значения
          const save = i
          const looksRef = /^[A-Za-z]+\d/.test(s.slice(i))
          if (looksRef) {
            args.push(...rangeValues())
          } else {
            i = save
            args.push(expr())
          }
          ws()
          if (s[i] === ',') {
            i++
            ws()
          }
        }
        if (s[i] === ')') i++
        const sum = args.reduce((a, b) => a + b, 0)
        switch (name) {
          case 'SUM':
            return sum
          case 'AVG':
          case 'AVERAGE':
          case 'СРЗНАЧ':
            return args.length ? sum / args.length : 0
          case 'MIN':
            return args.length ? Math.min(...args) : 0
          case 'MAX':
            return args.length ? Math.max(...args) : 0
          case 'COUNT':
          case 'СЧЁТ':
            return args.length
          default:
            return sum
        }
      }
      // ссылка на ячейку
      i = idStart
      const vals = rangeValues()
      return vals[0] ?? 0
    }
    function term(): number {
      let v = factor()
      ws()
      while (s[i] === '*' || s[i] === '/') {
        const op = s[i++]
        const rhs = factor()
        v = op === '*' ? v * rhs : rhs === 0 ? 0 : v / rhs
        ws()
      }
      return v
    }
    function expr(): number {
      let v = term()
      ws()
      while (s[i] === '+' || s[i] === '-') {
        const op = s[i++]
        const rhs = term()
        v = op === '+' ? v + rhs : v - rhs
        ws()
      }
      return v
    }
    const r = expr()
    return Math.round(r * 1e9) / 1e9
  }

  return compute
}

// Построить модель таблицы из массива строк (импорт Excel/CSV, генерация ИИ)
function sheetFromAoa(aoa: (string | number)[][]): SheetModel {
  const cells: Record<string, string> = {}
  let cols = 0
  aoa.forEach((row, r) => {
    if (!Array.isArray(row)) return
    row.forEach((v, c) => {
      if (v !== '' && v != null) cells[`${r}:${c}`] = String(v)
      if (c + 1 > cols) cols = c + 1
    })
  })
  return { rows: Math.max(aoa.length, 6), cols: Math.max(cols, 5), cells }
}
// Разобрать .xlsx/.xls/.csv в модель таблицы (первый лист) — используется и при дропе на холст.
// CSV читаем как UTF-8 текст (иначе SheetJS ломает кириллицу в кракозябры); xlsx — как байты.
export async function sheetModelFromFile(file: File): Promise<SheetModel> {
  let wb: XLSX.WorkBook
  if (/\.csv$/i.test(file.name)) {
    wb = XLSX.read(await file.text(), { type: 'string' })
  } else {
    wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  }
  const ws = wb.Sheets[wb.SheetNames[0]]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as any[]
  return sheetFromAoa(aoa)
}
function parseTableJson(text: string): SheetModel | null {
  try {
    const m = text.match(/\{[\s\S]*\}/)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = JSON.parse(m ? m[0] : text)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const headers: (string | number)[] = Array.isArray(raw.headers) ? raw.headers.map((x: any) => String(x)) : []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = Array.isArray(raw.rows) ? raw.rows : []
    const aoa: (string | number)[][] = [
      ...(headers.length ? [headers] : []),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...rows.map((r: any) => (Array.isArray(r) ? r.map((x: any) => (x == null ? '' : x)) : [String(r)]))
    ]
    if (!aoa.length) return null
    return sheetFromAoa(aoa)
  } catch {
    return null
  }
}
const sheetChoiceBtn = (color: string): React.CSSProperties => ({
  border: `1px solid color-mix(in srgb, ${color} 45%, var(--border))`,
  background: `color-mix(in srgb, ${color} 12%, transparent)`,
  color,
  borderRadius: 10,
  padding: '10px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  minWidth: 230
})

function SheetBody({ shape, editor, full }: { shape: FlowNodeShape; editor: Editor; full?: boolean }) {
  const update = useUpdate(editor, shape)
  // ХУКИ — до любых ранних return (правила hooks)
  const [focus, setFocus] = useState<string | null>(null)
  const [view, setView] = useState({ rows: 0, cols: 0 })
  const [gen, setGen] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ rows: 0, cols: 0 }) // сколько строк/столбцов влезает (заполняем экран)
  // Живой ресайз столбца/строки и перетаскивание строки — локально, коммит на pointerup
  const [drag, setDrag] = useState<{ type: 'col' | 'row'; i: number; size: number } | null>(null)
  const [dropRow, setDropRow] = useState<number | null>(null)

  const ex = (() => {
    try {
      return JSON.parse(shape.props.extra || '{}')
    } catch {
      return {}
    }
  })() as { sheet?: SheetModel; smode?: string; prompt?: string }
  const hasSheet = !!(ex.sheet && typeof ex.sheet.rows === 'number')
  const setEx = (patch: Record<string, unknown>) => update({ extra: JSON.stringify({ ...ex, ...patch }) })

  // Измеряем видимую область → рисуем на несколько строк/столбцов больше, чем влезает,
  // чтобы всегда была прокрутка (иначе «бесконечность» не запускается на большом экране).
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !hasSheet) return
    const rowPx = full ? 35 : 27
    const colPx = full ? 120 : 96
    const measure = (): void => setFit({ rows: Math.ceil(el.clientHeight / rowPx) + 4, cols: Math.ceil(el.clientWidth / colPx) + 2 })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [full, hasSheet])

  const importFile = async (file?: File | null) => {
    if (!file) return
    try {
      setEx({ sheet: await sheetModelFromFile(file), smode: undefined })
    } catch (e) {
      setErr('Не удалось прочитать файл: ' + String(e))
    }
  }
  const generate = async () => {
    if (!(ex.prompt || '').trim() || gen) return
    setGen(true)
    setErr(null)
    try {
      const sys =
        'Ты генерируешь табличные данные. По описанию верни ТОЛЬКО JSON вида ' +
        '{"headers":["Колонка1","Колонка2"],"rows":[["значение","значение"], ...]} без markdown-ограждений. ' +
        'Числа — числами. Заголовки и данные — на русском.'
      const res = await window.flow.aiChat({
        model: shape.props.model,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: ex.prompt || '' }]
      })
      if (res.ok) {
        const m = parseTableJson(res.content)
        if (m) setEx({ sheet: m, smode: undefined })
        else setErr('Не удалось разобрать ответ модели')
      } else setErr(res.error)
    } catch (e) {
      setErr(String(e))
    } finally {
      setGen(false)
    }
  }
  const hiddenFile = (
    <input
      ref={fileRef}
      type="file"
      accept=".xlsx,.xls,.csv"
      style={{ display: 'none' }}
      onChange={(e) => {
        importFile(e.currentTarget.files?.[0])
        e.currentTarget.value = ''
      }}
    />
  )

  // ---- Экран выбора: как создать таблицу ----
  if (!hasSheet && ex.smode !== 'ai') {
    return (
      <div onPointerDown={stopEventPropagation} style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', alignItems: 'center', justifyContent: 'center', padding: 14, textAlign: 'center' }}>
        {hiddenFile}
        <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.5, marginBottom: 2 }}>Как создать таблицу?</div>
        <button onClick={() => setEx({ sheet: { rows: 8, cols: 6, cells: {} } })} style={sheetChoiceBtn('#34D399')}>▦ Пустая таблица</button>
        <button onClick={() => setEx({ smode: 'ai' })} style={sheetChoiceBtn('#22D3EE')}>🤖 Описать в чате</button>
        <button onClick={() => fileRef.current?.click()} style={sheetChoiceBtn('var(--muted)')}>📥 Импорт Excel / CSV</button>
        {err && <div style={{ fontSize: 11, color: '#F87171' }}>{err}</div>}
      </div>
    )
  }

  // ---- Экран описания для ИИ ----
  if (!hasSheet && ex.smode === 'ai') {
    return (
      <div onPointerDown={stopEventPropagation} onWheelCapture={stopEventPropagation} style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
        <ModelSelect value={shape.props.model} onChange={(v) => update({ model: v })} />
        <textarea
          className="flow-input"
          value={ex.prompt || ''}
          onChange={(e) => setEx({ prompt: e.currentTarget.value })}
          placeholder="Опиши таблицу (напр. «бюджет на месяц: категория, план, факт»)…"
          style={{ ...fieldStyle, minHeight: 64, maxHeight: 130, resize: 'none', lineHeight: 1.4 }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setEx({ smode: undefined })} title="Назад" style={{ border: `1px solid ${C.border}`, background: 'transparent', color: C.text, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>←</button>
          <button
            onClick={generate}
            disabled={gen}
            style={{ flex: 1, cursor: gen ? 'default' : 'pointer', border: 'none', borderRadius: 10, padding: '8px', fontSize: 12.5, fontWeight: 600, color: '#00312a', background: gen ? '#3a3a3c' : 'linear-gradient(180deg,#6ee7b7,#34D399)' }}
          >
            {gen ? '🤖 Собираю…' : '🤖 Сгенерировать'}
          </button>
        </div>
        {err && <div style={{ fontSize: 11, color: '#F87171' }}>{err}</div>}
      </div>
    )
  }

  // ---- Сетка: бесконечная + ресайз столбцов/строк + перестановка строк ----
  const model = ex.sheet as SheetModel
  const compute = makeCompute(model)
  const save = (next: SheetModel) => setEx({ sheet: next })
  const setCell = (r: number, c: number, v: string) => {
    const cells = { ...model.cells }
    if (v === '') delete cells[`${r}:${c}`]
    else cells[`${r}:${c}`] = v
    save({ ...model, rows: Math.max(model.rows, r + 1), cols: Math.max(model.cols, c + 1), cells })
  }
  const exportXlsx = async () => {
    const aoa: (string | number)[][] = []
    for (let r = 0; r < model.rows; r++) {
      const row: (string | number)[] = []
      for (let c = 0; c < model.cols; c++) row.push(compute(r, c))
      aoa.push(row)
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Лист1')
    const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })
    await window.flow.saveFile({ base64, name: (shape.props.title || 'Таблица') + '.xlsx' })
  }

  const DEF_CW = full ? 120 : 96
  const DEF_RH = full ? 34 : 26
  const colWidth = (c: number): number => (drag && drag.type === 'col' && drag.i === c ? drag.size : model.colW?.[c] ?? DEF_CW)
  const rowHeight = (r: number): number => (drag && drag.type === 'row' && drag.i === r ? drag.size : model.rowH?.[r] ?? DEF_RH)

  // Перетащить строку from на место to (сдвигаем остальные)
  const moveRow = (from: number, to: number): void => {
    if (from === to) return
    const remap = (r: number): number => {
      if (r === from) return to
      if (from < to && r > from && r <= to) return r - 1
      if (from > to && r >= to && r < from) return r + 1
      return r
    }
    const cells: Record<string, string> = {}
    for (const [k, v] of Object.entries(model.cells)) {
      const [r, c] = k.split(':').map(Number)
      cells[`${remap(r)}:${c}`] = v
    }
    const rowH: Record<string, number> = {}
    for (const [k, v] of Object.entries(model.rowH || {})) rowH[remap(Number(k))] = v
    save({ ...model, cells, rowH })
  }

  // Ресайз столбца/строки перетаскиванием границы (живой предпросмотр в drag, коммит на pointerup)
  const startResize = (type: 'col' | 'row', i: number, e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const startPos = type === 'col' ? e.clientX : e.clientY
    const startSize = type === 'col' ? colWidth(i) : rowHeight(i)
    const minS = type === 'col' ? 44 : 20
    const sizeAt = (ev: PointerEvent): number => Math.max(minS, Math.round(startSize + ((type === 'col' ? ev.clientX : ev.clientY) - startPos)))
    const onMove = (ev: PointerEvent): void => setDrag({ type, i, size: sizeAt(ev) })
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const size = sizeAt(ev)
      if (type === 'col') save({ ...model, colW: { ...(model.colW || {}), [i]: size } })
      else save({ ...model, rowH: { ...(model.rowH || {}), [i]: size } })
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Сколько рисуем: не меньше данных+запас, измеренного заполнения экрана и «докрученного» скроллом
  const baseRows = fit.rows || (full ? 26 : 12)
  const baseCols = fit.cols || (full ? 12 : 6)
  const rows = Math.max(model.rows + 2, baseRows, view.rows)
  const cols = Math.max(model.cols + 1, baseCols, view.cols)
  const onScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 160) setView((v) => ({ rows: Math.max(v.rows, rows) + 20, cols: v.cols }))
    if (el.scrollLeft + el.clientWidth > el.scrollWidth - 200) setView((v) => ({ rows: v.rows, cols: Math.max(v.cols, cols) + 8 }))
  }

  const btn = { border: `1px solid ${C.border}`, background: 'color-mix(in srgb, var(--text) 5%, transparent)', color: C.text, borderRadius: 7, fontSize: full ? 13 : 11, padding: full ? '7px 13px' : '4px 8px', cursor: 'pointer' } as const
  const cellFs = full ? 15 : 12

  return (
    <div onPointerDown={stopEventPropagation} onWheelCapture={stopEventPropagation} style={{ display: 'flex', flexDirection: 'column', gap: full ? 12 : 8, height: '100%' }}>
      {hiddenFile}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={btn} onClick={() => fileRef.current?.click()} title="Импорт Excel/CSV">📥 Импорт</button>
        <button style={{ ...btn, borderColor: '#34D399', color: '#34D399' }} onClick={exportXlsx} title="Сохранить как .xlsx">⬇ Excel</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: full ? 11.5 : 10, color: C.textDim }}>тяни границы — размер · тяни № строки — переставить · прокрути — бесконечно</span>
      </div>
      <div ref={scrollRef} className="flow-scroll" onScroll={onScroll} style={{ flex: 1, overflow: 'auto', border: `1px solid ${SHEET_GRID}`, borderRadius: 8 }}>
        <table style={{ borderCollapse: 'collapse', fontFamily: NODE_MONO, fontSize: cellFs, userSelect: drag ? 'none' : undefined }}>
          <thead>
            <tr>
              <th style={{ ...sheetCorner, width: 44, minWidth: 44 }} />
              {Array.from({ length: cols }, (_, c) => {
                const w = colWidth(c)
                return (
                  <th key={c} style={{ ...sheetHead, position: 'relative', width: w, minWidth: w, maxWidth: w, fontSize: full ? 13 : 11, padding: full ? '7px 10px' : '4px 7px' }}>
                    {colName(c)}
                    <div onPointerDown={(e) => startResize('col', c, e)} title="Тяни — ширина столбца" style={{ position: 'absolute', top: 0, right: -3, width: 7, height: '100%', cursor: 'col-resize', zIndex: 6 }} />
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => {
              const rh = rowHeight(r)
              return (
                <tr key={r} style={{ height: rh }}>
                  <td
                    onDragOver={(e) => { e.preventDefault(); setDropRow(r) }}
                    onDragLeave={() => setDropRow((d) => (d === r ? null : d))}
                    onDrop={(e) => { e.preventDefault(); const from = Number(e.dataTransfer.getData('text/sheet-row')); if (!isNaN(from)) moveRow(from, r); setDropRow(null) }}
                    style={{ ...sheetRowHead, position: 'relative', padding: 0, width: 44, minWidth: 44, height: rh, fontSize: full ? 12 : 11, background: dropRow === r ? 'color-mix(in srgb, var(--accent) 26%, var(--panel2))' : 'var(--panel2)' }}
                  >
                    <span
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData('text/sheet-row', String(r)); e.dataTransfer.effectAllowed = 'move' }}
                      title="Тяни — переставить строку"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', cursor: 'grab' }}
                    >
                      {r + 1}
                    </span>
                    <div onPointerDown={(e) => startResize('row', r, e)} title="Тяни — высота строки" style={{ position: 'absolute', left: 0, bottom: -3, height: 7, width: '100%', cursor: 'row-resize', zIndex: 6 }} />
                  </td>
                  {Array.from({ length: cols }, (_, c) => {
                    const w = colWidth(c)
                    const key = `${r}:${c}`
                    const raw = model.cells[key] ?? ''
                    const isFormula = raw.startsWith('=')
                    const disp = focus === key ? raw : String(compute(r, c) ?? '')
                    const isNum = typeof compute(r, c) === 'number'
                    const cellBg = focus === key
                      ? 'color-mix(in srgb, var(--accent) 16%, transparent)'
                      : r % 2
                        ? 'color-mix(in srgb, var(--text) 4%, transparent)'
                        : 'transparent'
                    return (
                      <td key={c} style={{ border: `1px solid ${SHEET_GRID}`, padding: 0, background: cellBg, width: w, minWidth: w, maxWidth: w, height: rh }}>
                        <input
                          value={disp}
                          onFocus={() => setFocus(key)}
                          onBlur={() => setFocus(null)}
                          onChange={(e) => setCell(r, c, e.currentTarget.value)}
                          style={{
                            width: '100%',
                            height: rh,
                            boxSizing: 'border-box',
                            border: 'none',
                            outline: 'none',
                            background: 'transparent',
                            color: isFormula && focus !== key ? '#34D399' : C.text,
                            padding: full ? '0 12px' : '0 7px',
                            fontFamily: 'inherit',
                            fontSize: cellFs,
                            textAlign: isNum && focus !== key ? 'right' : 'left'
                          }}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: full ? 12 : 10.5, color: C.textDim }}>Формулы: =A1+B1, =SUM(A1:A5), =AVG(B1:B3), =MAX(...)</div>
    </div>
  )
}
// Линии сетки — от цвета текста темы, поэтому видны и на тёмной, и на светлой теме
// (на тёмной текст светлый → светлые линии; на светлой текст тёмный → тёмные линии).
const SHEET_GRID = 'color-mix(in srgb, var(--text) 20%, transparent)'
const sheetCorner = { position: 'sticky' as const, left: 0, top: 0, zIndex: 3, background: 'var(--panel2)', border: `1px solid ${SHEET_GRID}`, width: 30 }
const sheetHead = { position: 'sticky' as const, top: 0, zIndex: 2, background: 'var(--panel2)', border: `1px solid ${SHEET_GRID}`, color: 'var(--text)', fontWeight: 600, padding: '4px 7px', fontSize: 11 }
const sheetRowHead = { position: 'sticky' as const, left: 0, zIndex: 1, background: 'var(--panel2)', border: `1px solid ${SHEET_GRID}`, color: 'var(--muted)', textAlign: 'center' as const, padding: '4px 6px', fontSize: 11, minWidth: 30 }

function NodeView({
  shape,
  editor,
  isEditing
}: {
  shape: FlowNodeShape
  editor: Editor
  isEditing: boolean
}) {
  const update = useUpdate(editor, shape)
  const { title, kind, w, h } = shape.props
  const { color } = kindOf(kind)
  const [, force] = useState(0)
  const collapsed = collapsedMap.get(shape.id) ?? h <= HEADER_H + 6
  const isSelected = useValue('sel-' + shape.id, () => editor.getSelectedShapeIds().includes(shape.id), [editor, shape.id])
  const kindName = KIND_NAME[kind] || kind

  const toggleCollapse = (e: React.MouseEvent) => {
    stopEventPropagation(e)
    if (collapsed) {
      const restore = prevHMap.get(shape.id) ?? 180
      collapsedMap.set(shape.id, false)
      update({ h: restore })
    } else {
      prevHMap.set(shape.id, h)
      collapsedMap.set(shape.id, true)
      update({ h: HEADER_H })
    }
    force((n) => n + 1)
  }

  return (
    <HTMLContainer style={{ width: w, height: h, position: 'relative', pointerEvents: 'all', fontFamily: NODE_SANS }}>
      <PortDot side="left" color="var(--edge)" />
      <ContextPort editor={editor} sourceId={shape.id} color={color} />

      <div
        className="flow-node-card"
        style={{
          ['--nk' as string]: color,
          position: 'relative',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 12,
          overflow: 'hidden',
          background: 'linear-gradient(180deg, var(--panel2), var(--panel))',
          color: C.text,
          border: `1px solid ${isSelected ? `color-mix(in srgb, ${color} 55%, var(--border))` : 'var(--border)'}`,
          boxShadow: isSelected
            ? `0 14px 36px rgba(0,0,0,0.5), 0 0 0 1px color-mix(in srgb, ${color} 50%, transparent), 0 0 30px -2px color-mix(in srgb, ${color} 55%, transparent)`
            : '0 10px 30px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.05)',
          transition: 'box-shadow .18s ease, border-color .18s ease'
        } as React.CSSProperties}
      >
        {/* Верхняя акцентная полоса с бегущим бликом */}
        <div
          className="flow-accent-bar"
          style={{
            height: 2,
            flexShrink: 0,
            background: `linear-gradient(90deg, transparent, ${color}, color-mix(in srgb, ${color} 35%, transparent), ${color}, transparent)`
          }}
        />

        {/* Шапка (за неё двигаем ноду; двойной клик — редактировать заголовок) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 11px',
            flexShrink: 0,
            borderBottom: collapsed ? 'none' : `1px solid ${C.border}`
          }}
        >
          {/* Анимированная плашка-бейдж: что за нода */}
          <div
            className="flow-badge"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              flexShrink: 0,
              padding: '2px 8px 2px 7px',
              borderRadius: 999,
              background: `color-mix(in srgb, ${color} 16%, transparent)`,
              border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
              color,
              font: `600 9.5px ${NODE_MONO}`,
              letterSpacing: '.03em',
              textTransform: 'uppercase',
              lineHeight: 1
            }}
          >
            <span className="flow-badge-dot" style={{ width: 5, height: 5, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}`, flexShrink: 0 }} />
            <span style={{ display: 'flex', alignItems: 'center' }}>
              <NodeIcon kind={kind} size={12} />
            </span>
            <span style={{ whiteSpace: 'nowrap' }}>{kindName}</span>
          </div>
          {isEditing ? (
            <input
              className="flow-input"
              value={title}
              onPointerDown={stopEventPropagation}
              onChange={(e) => update({ title: e.currentTarget.value })}
              style={{
                flex: 1,
                background: C.field,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                color: C.text,
                padding: '3px 7px',
                fontSize: 12,
                fontFamily: NODE_MONO,
                outline: 'none'
              }}
            />
          ) : (
            <span
              style={{
                flex: 1,
                font: `500 10.5px ${NODE_MONO}`,
                color: C.textDim,
                letterSpacing: '.04em',
                textTransform: 'uppercase',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {title}
            </span>
          )}
          <button
            onPointerDown={stopEventPropagation}
            onClick={() => window.dispatchEvent(new CustomEvent('flow-fullscreen-node', { detail: String(shape.id) }))}
            title="На весь экран"
            style={{ border: 'none', background: 'none', color: C.textDim, fontSize: 12, padding: 0, cursor: 'pointer', lineHeight: 1 }}
          >
            ⛶
          </button>
          <button
            onPointerDown={stopEventPropagation}
            onClick={toggleCollapse}
            title={collapsed ? 'Развернуть' : 'Свернуть'}
            style={{ border: 'none', background: 'none', color: C.textDim, fontSize: 11, padding: 0, cursor: 'pointer' }}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        </div>

        {/* Тело */}
        {!collapsed && (
          <div style={{ flex: 1, padding: 11, overflow: 'hidden' }}>
            <NodeBodySwitch shape={shape} editor={editor} isEditing={isEditing} />
          </div>
        )}
      </div>
    </HTMLContainer>
  )
}

// Свитч тела ноды по типу — используется и в обычной ноде, и в полноэкранном режиме.
// ---------- Таймлайн доски: ось (год/месяц/неделя/открытая зона) ----------
function TlAxisBody({ shape }: { shape: FlowNodeShape }) {
  let ex: { label?: string; level?: string } = {}
  try {
    ex = JSON.parse(shape.props.extra || '{}')
  } catch {
    /* ignore */
  }
  const level = ex.level || 'week'
  const label = ex.label || ''
  if (level === 'open') {
    return (
      <div style={{ height: '100%', border: `2px dashed ${C.border}`, borderRadius: 14, position: 'relative', background: 'rgba(148,163,184,0.04)', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: 12, left: 16, font: `600 14px ${NODE_SANS}`, color: C.textDim, letterSpacing: '.04em' }}>🗂 {label || 'Свободная зона'}</div>
      </div>
    )
  }
  const bg = level === 'year' ? 'rgba(71,85,105,0.38)' : level === 'month' ? 'rgba(71,85,105,0.24)' : 'rgba(71,85,105,0.13)'
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: bg, borderRadius: 6, overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', font: `600 ${level === 'year' ? 13 : 12}px ${NODE_SANS}`, color: C.text, whiteSpace: 'nowrap', letterSpacing: '.06em' }}>{label}</div>
    </div>
  )
}

// ---------- Таймлайн доски: широкая полоса-день с выжимкой контекста ----------
function DayLaneBody({ shape, editor }: { shape: FlowNodeShape; editor: Editor }) {
  let ex: { iso?: string; boardId?: string } = {}
  try {
    ex = JSON.parse(shape.props.extra || '{}')
  } catch {
    /* ignore */
  }
  const boardId = ex.boardId || ''
  const iso = ex.iso || ''
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  // Выжимка дня: собрать контент нод, попадающих в полосу → выжимка (с учётом прошлой
  // памяти) → в память доски. Так «конец дня» передаётся в следующий день накопительно.
  const digest = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNote('Собираю выжимку дня…')
    try {
      const b = editor.getShapePageBounds(shape.id)
      if (!b) throw new Error('нет границ полосы')
      const parts: string[] = []
      for (const s of editor.getCurrentPageShapes()) {
        if (s.type !== 'flow-node' || s.id === shape.id) continue
        const fs = s as FlowNodeShape
        if (fs.props.kind === 'daylane' || fs.props.kind === 'tlaxis' || fs.props.kind === 'boardmem') continue
        const sb = editor.getShapePageBounds(s.id)
        if (!sb) continue
        const cy = sb.y + sb.h / 2
        const cx = sb.x + sb.w / 2
        // центр ноды попадает в вертикальный диапазон дня и правее левого края полосы
        if (cy >= b.y && cy < b.y + b.h && cx >= b.x - 40) {
          const ctx = extractNodeContext(editor, fs)
          if (ctx) parts.push(ctx)
        }
      }
      const content = parts.join('\n\n').slice(0, 12000)
      if (!content) {
        setNote('В этом дне нет контента для выжимки')
        return
      }
      const prior = boardMemText(boardId).slice(-6000)
      const res = await window.flow.aiChat({
        model: '',
        messages: [
          {
            role: 'system',
            content:
              'Ты ведёшь ГЛОБАЛЬНУЮ ПАМЯТЬ проекта на доске. По содержимому за день сделай сжатую выжимку (5–10 пунктов): ' +
              'что сделано, ключевые решения/факты/файлы, что важно помнить дальше. По-русски, по пунктам. ' +
              'Учитывай прошлую память для связности, но НЕ повторяй её — фиксируй только НОВОЕ за этот день.'
          },
          { role: 'user', content: `ПРОШЛАЯ ПАМЯТЬ ПРОЕКТА:\n${prior || '(пусто)'}\n\nСОДЕРЖИМОЕ ДНЯ ${iso}:\n${content}` }
        ],
        timeoutMs: 90000
      })
      if (!res.ok) throw new Error(res.error)
      appendBoardMem(boardId, { date: iso, text: res.content.trim(), ts: Date.now() })
      setNote('Выжимка добавлена в память доски ✓')
    } catch (e) {
      setNote('Ошибка: ' + (e as Error).message)
    } finally {
      setBusy(false)
      setTimeout(() => setNote(''), 4000)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', borderBottom: `1px solid ${C.border}`, background: 'rgba(100,116,139,0.10)' }}>
        <span style={{ font: `700 15px ${NODE_SANS}`, color: C.text, whiteSpace: 'nowrap' }}>{shape.props.title}</span>
        <div style={{ flex: 1 }} />
        {note && <span style={{ font: `500 11px ${NODE_SANS}`, color: C.textDim, whiteSpace: 'nowrap' }}>{note}</span>}
        <button
          onClick={digest}
          onPointerDown={stopEventPropagation}
          disabled={busy}
          style={{ border: 'none', background: KINDS.boardmem.grad, color: '#04121f', fontWeight: 700, borderRadius: 8, fontSize: 12, padding: '6px 12px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, fontFamily: NODE_SANS, whiteSpace: 'nowrap' }}
          title="Собрать выжимку контента этого дня в память доски (передаётся следующим дням)"
        >
          {busy ? '…' : '🧠 Выжимка дня → память'}
        </button>
      </div>
      {/* остальная площадь полосы — свободная зона для файлов/нод этого дня */}
      <div style={{ flex: 1 }} />
    </div>
  )
}

// ---------- Память доски: накопленные дневные выжимки ----------
function BoardMemBody({ shape }: { shape: FlowNodeShape }) {
  let ex: { boardId?: string } = {}
  try {
    ex = JSON.parse(shape.props.extra || '{}')
  } catch {
    /* ignore */
  }
  const boardId = ex.boardId || ''
  const [, force] = useState(0)
  useEffect(() => {
    const h = (e: Event): void => {
      if ((e as CustomEvent).detail === (boardId || 'default')) force((n) => n + 1)
    }
    window.addEventListener('flow-boardmem-updated', h)
    // Если кэш этой доски ещё не загружен из БД — подтянуть (событие вызовет перерисовку).
    if (!isBoardMemHydrated(boardId)) void hydrateBoardMem(boardId)
    return () => window.removeEventListener('flow-boardmem-updated', h)
  }, [boardId])
  const list = readBoardMem(boardId)
  return (
    <div onPointerDown={stopEventPropagation} onWheelCapture={stopEventPropagation} style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}`, font: `700 13px ${NODE_SANS}`, color: C.text }}>
        🧠 Память доски · {list.length} дн.
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '9px 12px', display: 'flex', flexDirection: 'column', gap: 11 }}>
        {list.length === 0 && (
          <div style={{ font: `400 12px ${NODE_SANS}`, color: C.textDim, lineHeight: 1.5 }}>
            Пусто. На любой дневной полосе нажми «🧠 Выжимка дня» — итог накопится здесь и будет
            передаваться следующим дням. Соедини эту ноду стрелкой с ИИ/оркестратором — он увидит всю память доски.
          </div>
        )}
        {list.map((e, i) => (
          <div key={i} style={{ borderLeft: `3px solid ${e.scope === 'month' ? '#F59E0B' : e.scope === 'week' ? '#60A5FA' : KINDS.boardmem.color}`, paddingLeft: 10 }}>
            <div style={{ font: `600 11px ${NODE_MONO}`, color: C.textDim, marginBottom: 3 }}>
              {e.scope === 'week' ? '🗓 ' : e.scope === 'month' ? '📅 ' : ''}
              {e.date}
            </div>
            <div style={{ font: `400 12px ${NODE_SANS}`, color: C.text, whiteSpace: 'pre-wrap', lineHeight: 1.42 }}>{e.text}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// T1.2: заглушка для ноды с повреждённым extra (невалидный JSON/не-объект). Данные не
// теряются — показываем kind и свёрнутый сырой JSON, холст продолжает работать.
function CorruptedBody({ shape }: { shape: FlowNodeShape }) {
  const [open, setOpen] = useState(false)
  const raw = corruptRaw(String(shape.id)) || shape.props.extra || ''
  return (
    <div
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <div style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}`, font: `700 13px ${NODE_SANS}`, color: '#EF4444' }}>
        ⚠ Повреждённые данные · {KIND_NAME[shape.props.kind] || shape.props.kind}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '9px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ font: `400 12px ${NODE_SANS}`, color: C.textDim, lineHeight: 1.5 }}>
          Не удалось разобрать данные ноды (`extra`). Ничего не потеряно — исходное содержимое ниже.
          Холст и остальные ноды работают как обычно.
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            alignSelf: 'flex-start',
            font: `600 11px ${NODE_SANS}`,
            color: C.text,
            background: C.field,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: '3px 9px',
            cursor: 'pointer'
          }}
        >
          {open ? 'Скрыть сырые данные' : 'Показать сырые данные'}
        </button>
        {open && (
          <pre
            style={{
              font: `400 11px ${NODE_MONO}`,
              color: C.textDim,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              margin: 0,
              background: C.field,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: 8
            }}
          >
            {raw}
          </pre>
        )}
      </div>
    </div>
  )
}

function NodeBodySwitch({
  shape,
  editor,
  isEditing,
  full
}: {
  shape: FlowNodeShape
  editor: Editor
  isEditing: boolean
  full?: boolean
}) {
  const kind = shape.props.kind
  if (isExtraCorrupt(String(shape.id))) return <CorruptedBody shape={shape} />
  return kind === 'ai' ? (
    <AiBody shape={shape} editor={editor} />
  ) : kind === 'kanban' ? (
    <KanbanBody shape={shape} editor={editor} />
  ) : kind === 'board' ? (
    <BoardBody shape={shape} editor={editor} />
  ) : kind === 'list' ? (
    <ListBody shape={shape} editor={editor} />
  ) : kind === 'listcard' ? (
    <ListCardBody shape={shape} editor={editor} />
  ) : kind === 'sheet' ? (
    <SheetBody shape={shape} editor={editor} full={full} />
  ) : kind === 'code' ? (
    <CodeRequestBody shape={shape} editor={editor} />
  ) : kind === 'codeblock' ? (
    <CodeBlockBody shape={shape} editor={editor} />
  ) : kind === 'search' ? (
    <SearchBody shape={shape} editor={editor} />
  ) : kind === 'image' ? (
    <ImageBody shape={shape} editor={editor} />
  ) : kind === 'ref' ? (
    <RefBody shape={shape} editor={editor} />
  ) : kind === 'deck' ? (
    <DeckBody shape={shape} editor={editor} />
  ) : kind === 'diagram' ? (
    <DiagramBody shape={shape} editor={editor} />
  ) : kind === 'opencode' ? (
    <OpencodeBody shape={shape} editor={editor} />
  ) : kind === 'anythingllm' ? (
    <AnythingBody shape={shape} editor={editor} />
  ) : kind === 'openscience' ? (
    <OpenscienceBody shape={shape} editor={editor} />
  ) : kind === 'webgpt' || kind === 'webgemini' || kind === 'webglm' ? (
    <WebLLMBody shape={shape} editor={editor} />
  ) : kind === 'daylane' ? (
    <DayLaneBody shape={shape} editor={editor} />
  ) : kind === 'tlaxis' ? (
    <TlAxisBody shape={shape} />
  ) : kind === 'boardmem' ? (
    <BoardMemBody shape={shape} />
  ) : kind === 'notebook' ? (
    <NotebookBody shape={shape} editor={editor} />
  ) : kind === 'pdf' ? (
    <PdfNodeBody shape={shape} editor={editor} />
  ) : kind === 'orchestrator' ? (
    <OrchestratorBody shape={shape} editor={editor} />
  ) : kind === 'orchtask' ? (
    <OrchTaskBody shape={shape} editor={editor} />
  ) : kind === 'orchcall' ? (
    <OrchCallBody shape={shape} />
  ) : kind === 'answer' ? (
    <AnswerBody shape={shape} editor={editor} />
  ) : (
    <SimpleBody shape={shape} editor={editor} isEditing={isEditing} />
  )
}

// Полноэкранный режим ноды: контент рендерится в реальный размер экрана (не как
// масштабированная текстура холста), поэтому webview/картинки/слайды — чёткие.
// Открывается кнопкой ⛶ в шапке; закрывается крестиком или Esc.
export function NodeFullscreenOverlay({
  shapeId,
  editor,
  onClose
}: {
  shapeId: string
  editor: Editor
  onClose: () => void
}) {
  // Подписываемся на шейп реактивно: оверлей — портал вне tldraw, и без этого он не
  // ре-рендерится при updateShape → ввод в таблицу «не печатается» (input затирается).
  const shape = useValue('fs-shape-' + shapeId, () => editor.getShape(shapeId as never) as FlowNodeShape | undefined, [editor, shapeId])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  if (!shape || shape.type !== 'flow-node') return null
  const meta = kindOf(shape.props.kind)
  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        background: 'var(--bg, #0d1117)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Шапка полноэкранного режима */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 14px',
          borderBottom: `1px solid ${C.border}`,
          background: C.card,
          flexShrink: 0
        }}
      >
        <span style={{ color: meta.color, display: 'flex', alignItems: 'center' }}>
          <NodeIcon kind={shape.props.kind} size={16} />
        </span>
        <span style={{ flex: 1, font: `500 12px ${NODE_MONO}`, color: C.text, letterSpacing: '.04em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {shape.props.title || shape.props.kind}
        </span>
        <button
          onClick={onClose}
          title="Свернуть (Esc)"
          style={{
            border: `1px solid ${C.border}`,
            background: C.field,
            color: C.text,
            borderRadius: 7,
            fontSize: 12,
            padding: '5px 12px',
            cursor: 'pointer',
            fontFamily: NODE_SANS,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}
        >
          ⤡ Свернуть
        </button>
      </div>
      {/* Тело на весь экран */}
      <div style={{ flex: 1, minHeight: 0, padding: 16, overflow: 'auto' }}>
        {shape.props.kind === 'slide' ? (
          <FullscreenSlide shape={shape} />
        ) : (
          <NodeBodySwitch shape={shape} editor={editor} isEditing={false} full />
        )}
      </div>
    </div>,
    document.body
  )
}

// Слайд на весь экран: вписываем 1280×720 в экран с сохранением пропорций,
// рендер в реальный размер — текст и блоки чёткие.
function FullscreenSlide({ shape }: { shape: FlowNodeShape }) {
  const fit = (): number =>
    Math.min(window.innerWidth - 48, 1280 * ((window.innerHeight - 120) / 720))
  const [w, setW] = useState(fit)
  useEffect(() => {
    const on = (): void => setW(fit())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const slide = parseSlide(shape.props.body)
  let image = ''
  try {
    image = JSON.parse(shape.props.extra || '{}').image || ''
  } catch {
    /* ignore */
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div style={{ boxShadow: '0 12px 44px rgba(0,0,0,0.5)', borderRadius: 12, overflow: 'hidden' }}>
        <ScaledSlide slide={slide} image={image} width={w} />
      </div>
    </div>
  )
}

// ---------- ShapeUtil ----------
export class FlowNodeShapeUtil extends ShapeUtil<FlowNodeShape> {
  static override type = 'flow-node' as const

  static override props: RecordProps<FlowNodeShape> = {
    w: T.number,
    h: T.number,
    kind: T.string,
    title: T.string,
    body: T.string,
    model: T.string,
    history: T.string,
    contextTokens: T.number,
    answerId: T.string,
    sourceId: T.string,
    extra: T.string
  }

  getDefaultProps(): FlowNodeShape['props'] {
    return {
      w: 280,
      h: 180,
      kind: 'note',
      title: 'Новая нода',
      body: '',
      model: '',
      history: '[]',
      contextTokens: 0,
      answerId: '',
      sourceId: '',
      extra: '{}'
    }
  }

  override canEdit() {
    return true
  }
  override canResize() {
    return true
  }

  getGeometry(shape: FlowNodeShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  override onResize(shape: FlowNodeShape, info: TLResizeInfo<FlowNodeShape>) {
    return resizeBox(shape, info)
  }

  component(shape: FlowNodeShape) {
    const editor = this.editor
    const isEditing = editor.getEditingShapeId() === shape.id
    // Слайд рисуется по-особому (без стандартной шапки ноды)
    if (shape.props.kind === 'slide') {
      return <SlideCard shape={shape} editor={editor} />
    }
    return <NodeView shape={shape} editor={editor} isEditing={isEditing} />
  }

  indicator(shape: FlowNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={10} />
  }
}
