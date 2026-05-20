import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Mail,
  Minus,
  NotebookText,
  PenLine,
  Plus,
  Search,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'

import BackgroundMesh from './BackgroundMesh'
import './App.css'

const API_BASE = 'http://localhost:8000'

const AGENTS = [
  {
    key: 'researcher',
    label: 'Researcher',
    color: 'blue',
    Icon: Search,
    subtitle: 'Finding relevant company context',
  },
  {
    key: 'writer',
    label: 'Writer',
    color: 'emerald',
    Icon: PenLine,
    subtitle: 'Creating the initial email draft',
  },
  {
    key: 'critic',
    label: 'Critic',
    color: 'amber',
    Icon: NotebookText,
    subtitle: 'Evaluating quality and proposing improvements',
  },
  {
    key: 'rewriter',
    label: 'Rewriter',
    color: 'violet',
    Icon: Sparkles,
    subtitle: 'Applying improvements and finalizing',
  },
]

function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}

function toNumberScore(value) {
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n) ? n : null
}

function normalizeScores(scores) {
  if (!scores || typeof scores !== 'object') return null
  const personalization = toNumberScore(scores.personalization)
  const clarity = toNumberScore(scores.clarity)
  const hook = toNumberScore(scores.hook)
  if (personalization == null && clarity == null && hook == null) return null
  return { personalization, clarity, hook }
}

function scoreTone(score) {
  if (score == null) return { label: '—', cls: 'bg-slate-100 text-slate-700 ring-slate-200' }
  if (score >= 8) return { label: `${score}/10`, cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200' }
  if (score >= 6) return { label: `${score}/10`, cls: 'bg-amber-50 text-amber-900 ring-amber-200' }
  return { label: `${score}/10`, cls: 'bg-rose-50 text-rose-900 ring-rose-200' }
}

function ProgressRing({ value, color = '#3b82f6' }) {
  const pct = Math.max(0, Math.min(100, Math.round(((value ?? 0) / 10) * 100)))
  const bg = `conic-gradient(${color} ${pct}%, rgba(15, 23, 42, 0.08) 0)`
  return (
    <div
      className="h-12 w-12 rounded-full p-[3px]"
      style={{ background: bg }}
      aria-label={`Score ${value ?? 'unknown'} out of 10`}
      title={value == null ? '—' : `${value}/10`}
    >
      <div className="grid h-full w-full place-items-center rounded-full bg-white text-[11px] font-semibold text-slate-800 shadow-sm">
        {value == null ? '—' : `${value}`}
      </div>
    </div>
  )
}

function formatEmail(email) {
  if (!email) return ''
  const subject = email.subject ? `Subject: ${email.subject}` : ''
  const body = email.body ?? ''
  return [subject, '', body].filter(Boolean).join('\n')
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

const LOG_BORDER_COLORS = {
  researcher: '#378ADD',
  writer: '#7F77DD',
  critic: '#BA7517',
  rewriter: '#1D9E75',
}

function guessDomain(name) {
  const core = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/,/g, ' ')
    .replace(/[^a-z0-9 .-]/g, '')

  if (!core) return null

  // If user pasted a bare domain-ish string
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(core)) return core.replace(/\.$/, '')
  const firstToken = core.split(/\s+/).filter(Boolean)[0] ?? ''
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(firstToken)) return firstToken.replace(/\.$/, '')

  // Simple brand → domain guesses (minimal; requirement for hackathon demos)
  const synonyms = {
    google: 'google.com',
    meta: 'meta.com',
    notion: 'notion.so',
    lenovo: 'lenovo.com',
    amazon: 'amazon.com',
    microsoft: 'microsoft.com',
    salesforce: 'salesforce.com',
    hubspot: 'hubspot.com',
    stripe: 'stripe.com',
  }
  const brand = core.split(/\s+/).filter(Boolean)[0] ?? ''
  if (brand && synonyms[brand]) return synonyms[brand]

  if (/^[a-z0-9-]+$/.test(brand)) return `${brand}.com`
  return null
}

function App() {
  const [company, setCompany] = useState('')
  const [submittedCompany, setSubmittedCompany] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [senderName, setSenderName] = useState('')
  const [extraContext, setExtraContext] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [suggestRelated, setSuggestRelated] = useState(false)
  const [targetCount, setTargetCount] = useState(1)
  const [batchRun, setBatchRun] = useState(null)
  const [selectedTargetIndex, setSelectedTargetIndex] = useState(0)
  const [demoMode, setDemoMode] = useState(true)
  const [loading, setLoading] = useState(false)
  const [activeAgent, setActiveAgent] = useState(null)
  const [transcript, setTranscript] = useState([])
  const [draft, setDraft] = useState(null)
  const [finalResult, setFinalResult] = useState(null)
  const [view, setView] = useState('draft') // 'draft' | 'final'
  const [copied, setCopied] = useState(false)

  const eventSourceRef = useRef(null)
  const copyTimerRef = useRef(null)
  const pipelineStartRef = useRef(null)
  const latestRef = useRef({ research: '', related_businesses: '', draft: null, final: null })
  const batchRunRef = useRef(null)

  useEffect(() => {
    batchRunRef.current = batchRun
  }, [batchRun])
  const [agentStatus, setAgentStatus] = useState({
    researcher: 'waiting',
    writer: 'waiting',
    critic: 'waiting',
    rewriter: 'waiting',
  })
  const [pipelineSeconds, setPipelineSeconds] = useState(null)
  const [showReset, setShowReset] = useState(false)

  const guessedDomain = useMemo(() => guessDomain(submittedCompany), [submittedCompany])

  const activeFinal = useMemo(() => {
    const r = batchRun?.results?.[selectedTargetIndex]
    if (r?.final) return r.final
    return finalResult
  }, [batchRun, selectedTargetIndex, finalResult])

  const scores = useMemo(() => normalizeScores(activeFinal?.scores), [activeFinal?.scores])

  const draftEmail = useMemo(() => {
    const r = batchRun?.results?.[selectedTargetIndex]
    if (batchRun && r) return r.draft ?? null
    return draft ?? null
  }, [batchRun, selectedTargetIndex, draft])

  const finalEmail = useMemo(() => {
    const r = batchRun?.results?.[selectedTargetIndex]
    if (r?.final?.rewritten_email) return r.final.rewritten_email
    return finalResult?.rewritten_email ?? null
  }, [batchRun, selectedTargetIndex, finalResult])

  const demoKey = useMemo(() => {
    const key = company.trim().toLowerCase()
    const toKey = recipientName.trim().toLowerCase()
    const fromKey = senderName.trim().toLowerCase()
    const ctxKey = extraContext.trim().toLowerCase()
    const relKey = suggestRelated ? 'rel1' : 'rel0'
    const tcKey = `tc${targetCount}`
    const full = [key, toKey, fromKey, ctxKey, relKey, tcKey].filter(Boolean).join('|')
    return full ? `multi_agent_sdr_demo:${full}` : null
  }, [company, recipientName, senderName, extraContext, suggestRelated, targetCount])

  const resetPipelineUi = useCallback(() => {
    setTranscript([])
    setDraft(null)
    setFinalResult(null)
    setView('draft')
    setActiveAgent(null)
    setAgentStatus({
      researcher: 'waiting',
      writer: 'waiting',
      critic: 'waiting',
      rewriter: 'waiting',
    })
    setPipelineSeconds(null)
    setShowReset(false)
    setCopied(false)
    setSubmittedCompany('')
    pipelineStartRef.current = null
    setBatchRun(null)
    setSelectedTargetIndex(0)

    latestRef.current = { research: '', related_businesses: '', draft: null, final: null }
    batchRunRef.current = null

    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
  }, [])

  const finishAgent = useCallback((key) => {
    setAgentStatus((prev) => {
      if ((prev[key] ?? 'waiting') === 'completed') return prev
      return { ...prev, [key]: 'completed' }
    })
  }, [])

  const startAgent = useCallback((key) => {
    setActiveAgent(key)
    setAgentStatus((prev) => {
      const next = { ...prev }
      AGENTS.forEach((a) => {
        const i = AGENTS.findIndex((x) => x.key === key)
        const j = AGENTS.findIndex((x) => x.key === a.key)
        if (j < i && next[a.key] !== 'completed') next[a.key] = 'waiting'
        if (a.key === key) next[a.key] = 'running'
        if (j > i && next[a.key] === 'running') next[a.key] = 'waiting'
      })
      return next
    })
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const companyTrimmed = company.trim()
    if (!companyTrimmed) return

    if (demoMode && demoKey) {
      const cached = localStorage.getItem(demoKey)
      if (cached) {
        try {
          const parsed = JSON.parse(cached)
          setTranscript([
            {
              id: crypto.randomUUID(),
              ts: Date.now(),
              type: 'system',
              title: 'Demo mode',
              content: 'Loaded cached run for reliability.',
              logAgent: null,
            },
          ])
          latestRef.current.research = parsed.research ?? ''
          if (parsed.batch && Array.isArray(parsed.results) && Array.isArray(parsed.targets)) {
            setBatchRun({
              targets: parsed.targets,
              results: parsed.results.map((row) => ({
                company: row.company,
                research: row.research,
                draft: row.draft ?? null,
                final: row.final ?? null,
                related_businesses: row.related_businesses ?? '',
              })),
            })
            setSelectedTargetIndex(0)
            const first = parsed.results[0]
            setDraft(first?.draft ?? null)
            setFinalResult(
              first?.final?.rewritten_email ? first.final : first?.finalResult ?? first?.final ?? null
            )
          } else {
            setBatchRun(null)
            setSelectedTargetIndex(0)
            setDraft(parsed.draft ?? null)
            setFinalResult(
              parsed.final?.rewritten_email ? parsed.final : parsed.finalResult ?? parsed.final ?? null
            )
          }
          if (parsed.batch && Array.isArray(parsed.results) && parsed.results[0]) {
            const first = parsed.results[0]
            latestRef.current.research = first.research ?? ''
            latestRef.current.draft = first.draft ?? null
            latestRef.current.final = first.final ?? null
          } else {
            latestRef.current.draft = parsed.draft ?? null
            latestRef.current.final =
              parsed.final?.rewritten_email ? parsed.final : parsed.finalResult ?? parsed.final ?? null
          }
          setView('draft')
          setActiveAgent(null)
          setAgentStatus({
            researcher: 'completed',
            writer: 'completed',
            critic: 'completed',
            rewriter: 'completed',
          })
          setPipelineSeconds(null)
          setShowReset(true)
          return
        } catch {
          // ignore cache parse errors; fall through
        }
      }
    }

    // reset run state (keep form fields intact)
    setTranscript([])
    setBatchRun(null)
    setSelectedTargetIndex(0)
    setDraft(null)
    setFinalResult(null)
    setView('draft')
    setCopied(false)
    setShowReset(false)
    setPipelineSeconds(null)
    pipelineStartRef.current = performance.now()
    setSubmittedCompany(companyTrimmed)
    setActiveAgent(null)
    setAgentStatus({
      researcher: 'waiting',
      writer: 'waiting',
      critic: 'waiting',
      rewriter: 'waiting',
    })

    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    setLoading(true)
    startAgent('researcher')

    const pushLine = (item) =>
      setTranscript((prev) => [
        ...prev,
        { id: crypto.randomUUID(), ts: Date.now(), ...item },
      ])

    const cacheCurrent = (partial = {}) => {
      if (!(demoMode && demoKey)) return
      try {
        latestRef.current = { ...latestRef.current, ...partial }
        const br = batchRunRef.current
        const payload = br
          ? {
            batch: true,
            targets: br.targets,
            results: br.results,
            research: br.results?.[0]?.research ?? latestRef.current.research ?? '',
            related_businesses: br.results?.[0]?.related_businesses ?? latestRef.current.related_businesses,
            draft: br.results?.[0]?.draft ?? latestRef.current.draft,
            final: br.results?.[0]?.final ?? latestRef.current.final,
          }
          : {
            research: latestRef.current.research,
            related_businesses: latestRef.current.related_businesses,
            draft: latestRef.current.draft,
            final: latestRef.current.final,
          }
        localStorage.setItem(demoKey, JSON.stringify(payload))
      } catch {
        // ignore quota issues
      }
    }

    const fallbackNonStreaming = async (reason) => {
      pushLine({
        type: 'system',
        title: 'Streaming unavailable',
        content: `${reason} Falling back to non-streaming generation.`,
        logAgent: null,
      })
      try {
        const res = await fetch(`${API_BASE}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company: companyTrimmed,
            recipient_name: recipientName.trim() || null,
            sender_name: senderName.trim() || null,
            context: extraContext.trim() || null,
            suggest_related: suggestRelated,
            target_count: targetCount,
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (data.batch && Array.isArray(data.results)) {
          const nextBatch = {
            targets: data.targets ?? [],
            results: data.results.map((row) => ({
              company: row.company,
              research: row.research,
              draft: row.draft ?? null,
              final: row.final ?? null,
              related_businesses: row.related_businesses ?? '',
            })),
          }
          batchRunRef.current = nextBatch
          setBatchRun(nextBatch)
          setSelectedTargetIndex(0)
          const first = data.results[0]
          latestRef.current.research = first?.research ?? ''
          latestRef.current.draft = first?.draft ?? null
          latestRef.current.final = first?.final ?? null
          setDraft(first?.draft ?? null)
          setFinalResult(first?.final ?? null)
        } else {
          batchRunRef.current = null
          setBatchRun(null)
          setSelectedTargetIndex(0)
          latestRef.current.research = data.research ?? ''
          setDraft(data.draft ?? null)
          setFinalResult(data.final ?? null)
          latestRef.current.draft = data.draft ?? null
          latestRef.current.final = data.final ?? null
        }
        setAgentStatus({
          researcher: 'completed',
          writer: 'completed',
          critic: 'completed',
          rewriter: 'completed',
        })
        setActiveAgent(null)
        if (pipelineStartRef.current != null) {
          const elapsed = Math.max(0, (performance.now() - pipelineStartRef.current) / 1000)
          setPipelineSeconds(Number(elapsed.toFixed(2)))
          pipelineStartRef.current = null
        }
        setShowReset(true)
        pushLine({
          type: 'done',
          title: 'Done',
          content: 'Generation completed.',
          logAgent: null,
        })
        if (demoMode && demoKey) {
          localStorage.setItem(demoKey, JSON.stringify(data))
        }
      } catch (err) {
        pushLine({
          type: 'error',
          title: 'Request failed',
          content: err?.message ?? String(err),
          logAgent: null,
        })
      } finally {
        setActiveAgent(null)
        setLoading(false)
      }
    }

    // Try SSE first (preferred)
    try {
      pushLine({
        type: 'system',
        title: 'Connecting',
        content: 'Starting multi-agent run (live).',
        logAgent: null,
      })

      const url = new URL(`${API_BASE}/generate-stream`)
      url.searchParams.set('company', companyTrimmed)
      if (recipientName.trim()) url.searchParams.set('recipient_name', recipientName.trim())
      if (senderName.trim()) url.searchParams.set('sender_name', senderName.trim())
      if (extraContext.trim()) url.searchParams.set('context', extraContext.trim())
      if (suggestRelated) url.searchParams.set('suggest_related', 'true')
      url.searchParams.set('target_count', String(targetCount))
      const es = new EventSource(url.toString())
      eventSourceRef.current = es

      es.onmessage = (evt) => {
        const data = safeJsonParse(evt.data)
        if (!data) {
          pushLine({
            type: 'raw',
            title: 'Event',
            content: evt.data,
            logAgent: null,
          })
          return
        }

        if (data.type === 'ping') {
          return
        }

        if (data.type === 'error') {
          pushLine({
            type: 'error',
            title: 'Pipeline error',
            content: data.message ?? 'Unknown error',
            logAgent: null,
          })
          es.close()
          eventSourceRef.current = null
          setLoading(false)
          setActiveAgent(null)
          setShowReset(true)
          return
        }

        if (data.type === 'batch_start') {
          const targets = data.targets ?? []
          const nextBatch = {
            targets,
            results: targets.map((c) => ({ company: c })),
          }
          batchRunRef.current = nextBatch
          setBatchRun(nextBatch)
          setSelectedTargetIndex(0)
          pushLine({
            type: 'system',
            title: 'Targets',
            content:
              targets.length <= 1
                ? `Running pipeline for: ${targets[0] ?? companyTrimmed}`
                : `Running ${targets.length} pipelines (shared context): ${targets.join(', ')}`,
            logAgent: null,
          })
          return
        }

        if (data.type === 'target_start') {
          const idx = data.index ?? 0
          const total = data.total ?? 0
          setSelectedTargetIndex(idx)
          setView('draft')
          setAgentStatus({
            researcher: 'waiting',
            writer: 'waiting',
            critic: 'waiting',
            rewriter: 'waiting',
          })
          startAgent('researcher')
          pushLine({
            type: 'system',
            title: `Target ${idx + 1}/${total || '?'}`,
            content: data.company ?? '',
            logAgent: null,
          })
          return
        }

        if (data.type === 'agent') {
          const agentKey = data.name
          if (agentKey) {
            const agentMeta = AGENTS.find((a) => a.key === agentKey)
            if (agentKey === 'critic') {
              finishAgent('writer')
              startAgent('critic')
            } else if (agentKey === 'rewriter') {
              finishAgent('critic')
              startAgent('rewriter')
            } else {
              startAgent(agentKey)
            }
            if (agentMeta) {
              pushLine({
                type: 'agent',
                title: agentMeta.label,
                content: 'Stage started.',
                accent: agentMeta.color,
                logAgent: agentKey,
              })
            }
          }
          return
        }

        if (data.type === 'related_businesses') {
          const idx = data.target_index ?? 0
          const co = data.target_company
          const content = data.content ?? ''
          setBatchRun((prev) => {
            if (!prev) return prev
            const results = prev.results.map((row, j) =>
              j === idx ? { ...row, related_businesses: content, company: co ?? row.company } : row
            )
            const next = { ...prev, results }
            batchRunRef.current = next
            return next
          })
          latestRef.current.related_businesses = content
          pushLine({
            type: 'research',
            title: co ? `Related businesses — ${co}` : 'Related businesses',
            content,
            accent: 'blue',
            logAgent: null,
          })
          cacheCurrent({ related_businesses: content })
          return
        }

        if (data.type === 'research') {
          finishAgent('researcher')
          const content = data.content ?? ''
          const idx = data.target_index ?? 0
          const co = data.target_company
          setBatchRun((prev) => {
            if (!prev) return prev
            const results = prev.results.map((row, j) =>
              j === idx ? { ...row, research: content, company: co ?? row.company } : row
            )
            const next = { ...prev, results }
            batchRunRef.current = next
            return next
          })
          latestRef.current.research = content
          pushLine({
            type: 'research',
            title: co ? `Research — ${co}` : 'Research summary',
            content,
            accent: 'blue',
            logAgent: 'researcher',
          })
          cacheCurrent({ research: content })
          return
        }

        if (data.type === 'draft') {
          const content = data.content ?? null
          const idx = data.target_index ?? 0
          const co = data.target_company
          setBatchRun((prev) => {
            if (!prev) return prev
            const results = prev.results.map((row, j) =>
              j === idx ? { ...row, draft: content, company: co ?? row.company } : row
            )
            const next = { ...prev, results }
            batchRunRef.current = next
            return next
          })
          latestRef.current.draft = content
          setDraft(content)
          setSelectedTargetIndex(idx)
          setView('draft')
          pushLine({
            type: 'draft',
            title: co ? `Draft email — ${co}` : 'Draft email',
            content: content?.subject
              ? `Subject: ${content.subject}\n\n${content.body ?? ''}`.trim()
              : JSON.stringify(content, null, 2),
            accent: 'emerald',
            logAgent: 'writer',
          })
          cacheCurrent({ draft: content })
          return
        }

        if (data.type === 'final') {
          finishAgent('rewriter')
          const content = data.content ?? null
          const idx = data.target_index ?? 0
          const co = data.target_company
          setBatchRun((prev) => {
            if (!prev) return prev
            const results = prev.results.map((row, j) =>
              j === idx ? { ...row, final: content, company: co ?? row.company } : row
            )
            const next = { ...prev, results }
            batchRunRef.current = next
            return next
          })
          latestRef.current.final = content
          setFinalResult(content)
          setSelectedTargetIndex(idx)
          setView('final')
          const scoreText = normalizeScores(content?.scores)
            ? `Scores — Personalization ${content.scores.personalization}/10, Clarity ${content.scores.clarity}/10, Hook ${content.scores.hook}/10`
            : 'Final output received.'
          pushLine({
            type: 'final',
            title: co ? `Critique + rewrite — ${co}` : 'Critique + rewrite',
            content: [scoreText, content?.critique_text, '—', formatEmail(content?.rewritten_email)]
              .filter(Boolean)
              .join('\n')
              .trim(),
            accent: 'violet',
            logAgent: 'rewriter',
          })
          cacheCurrent({ final: content })
          return
        }

        if (data.type === 'target_done') {
          pushLine({
            type: 'system',
            title: `Finished ${data.company ?? 'target'}`,
            content: `Completed ${(data.index ?? 0) + 1} of ${data.total ?? '?'}.`,
            logAgent: null,
          })
          return
        }

        if (data.type === 'done') {
          pushLine({ type: 'done', title: 'Done', content: 'All agents completed.', logAgent: null })
          es.close()
          eventSourceRef.current = null
          setLoading(false)
          setActiveAgent(null)
          setAgentStatus({
            researcher: 'completed',
            writer: 'completed',
            critic: 'completed',
            rewriter: 'completed',
          })
          if (pipelineStartRef.current != null) {
            const elapsed = Math.max(0, (performance.now() - pipelineStartRef.current) / 1000)
            setPipelineSeconds(Number(elapsed.toFixed(2)))
            pipelineStartRef.current = null
          }
          setShowReset(true)
          cacheCurrent()
          return
        }

        pushLine({
          type: 'event',
          title: data.type ?? 'Event',
          content: JSON.stringify(data, null, 2),
          logAgent: null,
        })
      }

      es.onerror = () => {
        es.close()
        eventSourceRef.current = null
        fallbackNonStreaming('SSE connection error.')
      }
    } catch (err) {
      await fallbackNonStreaming(err?.message ? `${err.message}.` : 'SSE setup failed.')
    }
  }

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close()
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
    }
  }, [])

  const emailToShow = view === 'draft' ? draftEmail : finalEmail
  const emailReady = Boolean(emailToShow?.subject || emailToShow?.body)
  const canToggle = Boolean(draftEmail?.subject || draftEmail?.body) && Boolean(finalEmail?.subject || finalEmail?.body)
  const canCopyAllFinals = useMemo(
    () =>
      Boolean(
        batchRun?.results?.some((r) => {
          const em = r.final?.rewritten_email
          return em && (em.subject || em.body)
        })
      ),
    [batchRun]
  )

  const formattedCopy = useMemo(() => {
    if (!emailToShow) return ''
    const toLine = recipientName.trim() ? `To: ${recipientName.trim()}` : 'To: (recipient)'
    const fromLine = senderName.trim() ? `From: ${senderName.trim()}` : 'From: (you)'
    const co =
      batchRun?.targets?.[selectedTargetIndex] ??
      batchRun?.results?.[selectedTargetIndex]?.company ??
      ''
    const coLine = co ? `Company: ${co}` : null
    const subjectLine = emailToShow.subject ? `Subject: ${emailToShow.subject}` : 'Subject:'
    return [toLine, fromLine, coLine, subjectLine, '', emailToShow.body ?? ''].filter(Boolean).join('\n')
  }, [emailToShow, recipientName, senderName, batchRun, selectedTargetIndex])

  const handleCopy = async () => {
    if (!emailReady) return
    try {
      await navigator.clipboard.writeText(formattedCopy)
      setCopied(true)
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
      setTranscript((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          ts: Date.now(),
          type: 'error',
          title: 'Copy failed',
          content: 'Clipboard permission was blocked by the browser.',
          logAgent: null,
        },
      ])
    }
  }

  const handleCopyAllFinals = async () => {
    if (!batchRun?.results?.length) return
    const blocks = batchRun.results
      .map((r, idx) => {
        const co = batchRun.targets[idx] ?? r.company ?? `Target ${idx + 1}`
        const em = r.final?.rewritten_email
        if (!em || (!em.subject && !em.body)) return null
        const subj = em.subject ? `Subject: ${em.subject}` : 'Subject:'
        const body = em.body ?? ''
        return [`Company: ${co}`, subj, '', body].join('\n')
      })
      .filter(Boolean)
    if (!blocks.length) return
    const text = blocks.join('\n\n---\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setTranscript((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          ts: Date.now(),
          type: 'error',
          title: 'Copy failed',
          content: 'Clipboard permission was blocked by the browser.',
          logAgent: null,
        },
      ])
    }
  }

  return (
    <>
      <BackgroundMesh />
      <div className="mx-auto max-w-[1320px] px-4 py-6 md:px-6 md:py-8 relative">
      <header className="mb-5 flex flex-col gap-3 md:mb-7 md:flex-row md:items-start md:justify-between">
        <div className="text-left">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 shadow-sm">
            <Sparkles className="h-4 w-4 text-violet-600" />
            Multi-agent pipeline: Research → Write → Critique → Rewrite
          </div>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">
            SDR Tool
          </h1>
          <p className="mt-1 max-w-[62ch] text-sm text-slate-600 md:text-base">
            Transparent, step-by-step AI sales email generation — designed to show the critic-rewrite loop working in real time.
          </p>
          {pipelineSeconds != null ? (
            <div className="mt-3 text-xs font-semibold text-slate-600">
              Pipeline completed in{' '}
              <span className="font-mono text-slate-900">{pipelineSeconds.toFixed(2)}</span>s
            </div>
          ) : null}
          {showReset ? (
            <button
              type="button"
              onClick={() => {
                resetPipelineUi()
                setCompany('')
                setRecipientName('')
                setSenderName('')
                setExtraContext('')
                setShowAdvanced(false)
              }}
              className="mt-3 text-left text-xs font-semibold text-slate-800 underline decoration-slate-300 underline-offset-4 hover:text-slate-950"
            >
              Try another company →
            </button>
          ) : null}
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex w-full flex-col gap-2 md:w-auto md:min-w-[520px] md:pt-1"
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Company name (e.g., Notion)"
                className="w-full rounded-xl bg-white/80 py-3 pl-10 pr-3 text-sm text-slate-900 ring-1 ring-slate-200 shadow-sm outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-400"
                disabled={loading}
              />
              {(loading || submittedCompany) && guessedDomain ? (
                <img
                  src={`https://logo.clearbit.com/${guessedDomain}`}
                  alt=""
                  className="pointer-events-none absolute right-3 top-1/2 h-8 w-8 -translate-y-1/2 rounded-lg bg-white/80 p-1 ring-1 ring-slate-200"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              ) : null}
            </div>
            <button
              type="submit"
              disabled={loading || !company.trim()}
              className={cx(
                'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-soft ring-1 transition',
                loading || !company.trim()
                  ? 'cursor-not-allowed bg-slate-200 text-slate-500 ring-slate-200'
                  : 'bg-slate-900 text-white ring-slate-900 hover:bg-slate-800'
              )}
            >
              <Sparkles className={cx('h-4 w-4', loading ? 'animate-pulse' : '')} />
              {loading ? 'Generating…' : 'Generate'}
            </button>
          </div>

          <label className="inline-flex items-center gap-2 text-left text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-blue-400"
              checked={demoMode}
              onChange={(e) => setDemoMode(e.target.checked)}
              disabled={loading}
            />
            Demo mode (cache results per company for consistent demos)
          </label>

          <div className="rounded-xl bg-white/60 p-3 ring-1 ring-slate-200/80">
            <div className="flex flex-col gap-2 text-left">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-semibold text-slate-700">Businesses to generate</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Decrease number of businesses"
                    onClick={() => setTargetCount((c) => Math.max(1, c - 1))}
                    disabled={loading || targetCount <= 1}
                    className={cx(
                      'inline-flex h-9 w-9 items-center justify-center rounded-xl ring-1 shadow-sm transition',
                      loading || targetCount <= 1
                        ? 'cursor-not-allowed bg-slate-100 text-slate-400 ring-slate-200'
                        : 'bg-white text-slate-900 ring-slate-200 hover:bg-slate-50'
                    )}
                  >
                    <Minus className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                  <span className="min-w-[2.25rem] text-center font-mono text-sm font-semibold tabular-nums text-slate-900">
                    {targetCount}
                  </span>
                  <button
                    type="button"
                    aria-label="Increase number of businesses"
                    onClick={() => setTargetCount((c) => Math.min(8, c + 1))}
                    disabled={loading || targetCount >= 8}
                    className={cx(
                      'inline-flex h-9 w-9 items-center justify-center rounded-xl ring-1 shadow-sm transition',
                      loading || targetCount >= 8
                        ? 'cursor-not-allowed bg-slate-100 text-slate-400 ring-slate-200'
                        : 'bg-white text-slate-900 ring-slate-200 hover:bg-slate-50'
                    )}
                  >
                    <Plus className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                </div>
              </div>
              <p className="text-[11px] leading-snug text-slate-500">
                Same recipient, signature, and extra context for every message. Extra companies are picked as peers of the
                name you type; the pipeline runs once per business so each email is researched and rewritten
                independently.
              </p>
            </div>
            <label className="mt-3 inline-flex cursor-pointer items-start gap-2 text-left text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-slate-900 focus:ring-blue-400"
                checked={suggestRelated}
                onChange={(e) => setSuggestRelated(e.target.checked)}
                disabled={loading}
              />
              <span>Include related-business positioning notes from web search (per company, for the writer only).</span>
            </label>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-left text-xs font-semibold text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-900"
          >
            {showAdvanced ? 'Hide' : 'Add'} context (name, offer, tone)
          </button>

          <div
            className={cx(
              'overflow-hidden transition-[max-height,opacity] duration-250 ease-out',
              showAdvanced ? 'max-h-[420px] opacity-100' : 'max-h-0 opacity-0'
            )}
          >
            <div className="mt-1 rounded-xl bg-white/70 p-3 ring-1 ring-slate-200 shadow-sm">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-600">Recipient name</label>
                  <input
                    type="text"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="e.g., Priya"
                    className="w-full rounded-xl bg-white/80 px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200 shadow-sm outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-400"
                    disabled={loading}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-600">Your name (signature)</label>
                  <input
                    type="text"
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    placeholder="e.g., Alex"
                    className="w-full rounded-xl bg-white/80 px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200 shadow-sm outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-400"
                    disabled={loading}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-semibold text-slate-600">Extra context</label>
                  <textarea
                    value={extraContext}
                    onChange={(e) => setExtraContext(e.target.value)}
                    placeholder="Paste context: who you are, what you sell, target persona, pain points, CTA, tone constraints (e.g., ‘friendly, not salesy’), etc."
                    className="h-24 w-full resize-none rounded-xl bg-white/80 px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200 shadow-sm outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-400"
                    disabled={loading}
                  />
                </div>
              </div>
            </div>
          </div>
        </form>
      </header>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        {/* Left: transcript */}
        <div className="rounded-2xl bg-white/70 p-4 shadow-soft ring-1 ring-slate-200 backdrop-blur-md md:p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-900 text-white shadow-sm">
                <NotebookText className="h-5 w-5" />
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-slate-900">Agent activity log</div>
                <div className="text-xs text-slate-500">Structured updates from each stage of the pipeline.</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {loading ? (
                <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm ring-1 ring-slate-900">
                  Live
                </span>
              ) : null}
              {activeAgent ? (
                <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
                  Running: {AGENTS.find((a) => a.key === activeAgent)?.label ?? activeAgent}
                </span>
              ) : null}
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {AGENTS.map((a) => {
              const active = agentStatus[a.key] === 'running'
              const waiting = !active && agentStatus[a.key] === 'waiting'
              const done = !active && agentStatus[a.key] === 'completed'
              return (
                <div
                  key={a.key}
                  className={cx(
                    'rounded-xl p-3 ring-1 shadow-sm transition-all duration-300',
                    waiting ? 'bg-slate-50/50 ring-slate-200 opacity-60' : '',
                    active ? 'bg-white ring-blue-400 shadow-md -translate-y-1 scale-[1.02] sdr-active-pulse' : '',
                    done ? 'bg-white/80 ring-slate-200 opacity-100' : '',
                    !waiting && !active && !done ? 'bg-white/80 ring-slate-200' : ''
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={cx(
                          'grid h-9 w-9 place-items-center rounded-xl text-white shadow-sm transition-colors',
                          active ? (a.color === 'blue' ? 'bg-blue-600' : a.color === 'emerald' ? 'bg-emerald-600' : a.color === 'amber' ? 'bg-amber-500' : 'bg-violet-600') : 'bg-slate-300'
                        )}
                      >
                        <a.Icon className="h-5 w-5" />
                      </div>
                      <div className="text-left">
                        <div className={cx('text-xs font-semibold', active ? 'text-slate-900' : 'text-slate-500')}>{a.label}</div>
                        <div className="text-[11px] text-slate-400">Stage</div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="h-[520px] overflow-auto rounded-xl bg-white/80 p-3 ring-1 ring-slate-200 shadow-sm md:h-[560px]">
            {transcript.length === 0 ? (
              <div className="grid h-full place-items-center">
                <div className="max-w-[46ch] text-center">
                  <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-slate-900 text-white shadow-sm">
                    <Mail className="h-6 w-6" />
                  </div>
                  <div className="text-sm font-semibold text-slate-900">Run a company through the pipeline</div>
                  <div className="mt-1 text-xs text-slate-600">
                    You’ll see the Researcher → Writer → Critic → Rewriter sequence, with the email evolving step-by-step.
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-left">
                {transcript.map((t) => {
                  const accent =
                    t.accent === 'blue'
                      ? 'border-blue-300 bg-blue-50/50'
                      : t.accent === 'emerald'
                        ? 'border-emerald-300 bg-emerald-50/50'
                        : t.accent === 'amber'
                          ? 'border-amber-300 bg-amber-50/50'
                          : t.accent === 'violet'
                            ? 'border-violet-300 bg-violet-50/50'
                            : t.type === 'error'
                              ? 'border-rose-300 bg-rose-50/60'
                              : 'border-slate-200 bg-white/70'

                  let leftBorderColor = '#cbd5e1'
                  if (t.logAgent && LOG_BORDER_COLORS[t.logAgent]) {
                    leftBorderColor = LOG_BORDER_COLORS[t.logAgent]
                  } else {
                    const titleLc = String(t.title ?? '').toLowerCase()
                    if (titleLc.includes('research')) leftBorderColor = LOG_BORDER_COLORS.researcher
                    else if (titleLc.includes('draft')) leftBorderColor = LOG_BORDER_COLORS.writer
                    else if (titleLc.includes('critique')) leftBorderColor = LOG_BORDER_COLORS.critic
                    else if (
                      ['rewriter', 'rewrite', 'rewritten'].some((w) =>
                        `${titleLc} ${String(t.content ?? '').toLowerCase()}`.includes(w)
                      )
                    ) {
                      leftBorderColor = LOG_BORDER_COLORS.rewriter
                    } else if (AGENTS.some((a) => a.label.toLowerCase() === titleLc)) {
                      leftBorderColor = LOG_BORDER_COLORS[AGENTS.find((a) => a.label.toLowerCase() === titleLc)?.key ?? 'researcher']
                    }
                  }

                  const titleIcon =
                    t.type === 'error' ? (
                      <TriangleAlert className="h-4 w-4 text-rose-600" />
                    ) : (
                      <div className="h-2 w-2 rounded-full bg-slate-400" />
                    )

                  return (
                    <div
                      key={t.id}
                      style={{ borderLeftColor: leftBorderColor, borderLeftWidth: 4 }}
                      className={cx('sdr-fade-up rounded-xl border p-3', accent)}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        {titleIcon}
                        <div className="text-xs font-semibold text-slate-900">{t.title ?? 'Update'}</div>
                        <div className="ml-auto text-[10px] font-medium text-slate-500">
                          {new Date(t.ts).toLocaleTimeString()}
                        </div>
                      </div>
                      <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700">
                        {t.content}
                      </pre>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: preview */}
        <div className="rounded-2xl bg-white/70 p-4 shadow-soft ring-1 ring-slate-200 backdrop-blur-md md:p-5">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-600 text-white shadow-sm">
                <Mail className="h-5 w-5" />
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-slate-900">Email preview</div>
                <div className="text-xs text-slate-500">Draft vs rewritten, with score transparency.</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {batchRun && batchRun.targets.length > 1 ? (
                <button
                  type="button"
                  onClick={handleCopyAllFinals}
                  disabled={loading || !canCopyAllFinals}
                  className={cx(
                    'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ring-1 shadow-sm transition',
                    loading || !canCopyAllFinals
                      ? 'cursor-not-allowed bg-slate-100 text-slate-400 ring-slate-200'
                      : 'bg-white/80 text-slate-900 ring-slate-200 hover:bg-white'
                  )}
                >
                  Copy all finals
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setView('draft')}
                disabled={!canToggle}
                className={cx(
                  'rounded-full px-3 py-1 text-xs font-semibold ring-1 transition',
                  view === 'draft'
                    ? 'bg-emerald-600 text-white ring-emerald-600'
                    : 'bg-white/80 text-slate-700 ring-slate-200 hover:bg-white',
                  !canToggle ? 'cursor-not-allowed opacity-50' : ''
                )}
              >
                Before (draft)
              </button>
              <button
                type="button"
                onClick={() => setView('final')}
                disabled={!canToggle}
                className={cx(
                  'rounded-full px-3 py-1 text-xs font-semibold ring-1 transition',
                  view === 'final'
                    ? 'bg-violet-600 text-white ring-violet-600'
                    : 'bg-white/80 text-slate-700 ring-slate-200 hover:bg-white',
                  !canToggle ? 'cursor-not-allowed opacity-50' : ''
                )}
              >
                After (rewrite)
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!emailReady}
                  className={cx(
                    'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ring-1 shadow-sm transition',
                    emailReady
                      ? 'bg-white/80 text-slate-900 ring-slate-200 hover:bg-white'
                      : 'cursor-not-allowed bg-slate-100 text-slate-400 ring-slate-200'
                  )}
                >
                  <span className="inline-flex items-center">{copied ? '✅ Copied!' : 'Copy'}</span>
                </button>
              </div>
            </div>
          </div>

          {batchRun && batchRun.targets.length > 1 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {batchRun.targets.map((name, idx) => (
                <button
                  key={`${name}-${idx}`}
                  type="button"
                  onClick={() => {
                    setSelectedTargetIndex(idx)
                    const r = batchRun?.results?.[idx]
                    const em = r?.final?.rewritten_email
                    const hasFinal = Boolean(em && (em.subject || em.body))
                    setView((v) => (v === 'final' && !hasFinal ? 'draft' : v))
                  }}
                  className={cx(
                    'max-w-full truncate rounded-full px-3 py-1.5 text-left text-xs font-semibold ring-1 transition',
                    selectedTargetIndex === idx
                      ? 'bg-slate-900 text-white ring-slate-900'
                      : 'bg-white/80 text-slate-700 ring-slate-200 hover:bg-white'
                  )}
                  title={name}
                >
                  {name}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-left">
                  <div className="text-xs font-semibold text-slate-900">Personalization</div>
                  <div className="text-[11px] text-slate-500">Relevance to company</div>
                </div>
                <ProgressRing value={scores?.personalization} color="#10b981" />
              </div>
              <div className="mt-3">
                <span className={cx('inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ring-1', scoreTone(scores?.personalization).cls)}>
                  {scoreTone(scores?.personalization).label}
                </span>
                <div className="mt-1 text-[10px] text-slate-500">avg cold email: 2/10</div>
              </div>
            </div>

            <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-left">
                  <div className="text-xs font-semibold text-slate-900">Clarity</div>
                  <div className="text-[11px] text-slate-500">Scannable & direct</div>
                </div>
                <ProgressRing value={scores?.clarity} color="#3b82f6" />
              </div>
              <div className="mt-3">
                <span className={cx('inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ring-1', scoreTone(scores?.clarity).cls)}>
                  {scoreTone(scores?.clarity).label}
                </span>
                <div className="mt-1 text-[10px] text-slate-500">avg cold email: 3/10</div>
              </div>
            </div>

            <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-left">
                  <div className="text-xs font-semibold text-slate-900">Hook</div>
                  <div className="text-[11px] text-slate-500">Interest & CTA</div>
                </div>
                <ProgressRing value={scores?.hook} color="#f59e0b" />
              </div>
              <div className="mt-3">
                <span className={cx('inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ring-1', scoreTone(scores?.hook).cls)}>
                  {scoreTone(scores?.hook).label}
                </span>
                <div className="mt-1 text-[10px] text-slate-500">avg cold email: 2/10</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200 shadow-sm md:p-5">
            {!emailReady ? (
              <div className="grid h-[420px] place-items-center md:h-[520px]">
                <div className="max-w-[46ch] text-center">
                  <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-slate-900 text-white shadow-sm">
                    <Mail className="h-6 w-6" />
                  </div>
                  <div className="text-sm font-semibold text-slate-900">No email yet</div>
                  <div className="mt-1 text-xs text-slate-600">
                    Start a run to see the email evolve from the Writer’s draft to the Rewriter’s final version.
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-left">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className={cx('inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1',
                    view === 'draft'
                      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                      : 'bg-violet-50 text-violet-800 ring-violet-200'
                  )}>
                    {view === 'draft' ? 'Before (draft)' : 'After (rewrite)'}
                  </span>
                  <span className="text-xs font-medium text-slate-500">
                    {view === 'draft'
                      ? 'Writer output'
                      : 'Critic + Rewriter output'}
                  </span>
                </div>

                <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
                  <div className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1 text-xs">
                    <div className="font-semibold text-slate-500">To</div>
                    <div className="font-semibold text-slate-900">{recipientName.trim() || '—'}</div>
                    <div className="font-semibold text-slate-500">From</div>
                    <div className="font-semibold text-slate-900">{senderName.trim() || '—'}</div>
                    {batchRun?.targets?.[selectedTargetIndex] ? (
                      <>
                        <div className="font-semibold text-slate-500">Company</div>
                        <div className="font-semibold text-slate-900">{batchRun.targets[selectedTargetIndex]}</div>
                      </>
                    ) : null}
                    <div className="font-semibold text-slate-500">Subject</div>
                    <div className="font-semibold text-slate-900">{emailToShow?.subject || '—'}</div>
                  </div>
                </div>

                {activeFinal?.critique_text && view === 'final' ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                    <div className="mb-2 text-xs font-semibold text-amber-900">Critic notes</div>
                    <div className="whitespace-pre-wrap text-xs leading-relaxed text-amber-900/90">
                      {activeFinal.critique_text}
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 rounded-xl bg-white p-4 ring-1 ring-slate-200">
                  <div className="mb-2 text-xs font-semibold text-slate-500">Message</div>
                  <div className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800">
                    {emailToShow?.body || '—'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <footer className="mt-6 text-left text-xs text-slate-500">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 ring-1 ring-slate-200 shadow-sm">
            <span className="font-semibold text-slate-700">Backend</span>
            <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700">
              {API_BASE}
            </code>
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 ring-1 ring-slate-200 shadow-sm">
            <span className="font-semibold text-slate-700">Tip</span>
            <span>Use the before/after toggle to show the rewrite loop.</span>
          </span>
        </div>
      </footer>
    </div>
    </>
  )
}

export default App