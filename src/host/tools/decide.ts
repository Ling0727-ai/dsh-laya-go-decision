/**
 * `laya_go_decide`: answer typed questions about one state with the local
 * Laya Go Launcher model in a single forward pass.
 *
 * The tool is a thin projection of `ctx.layaGoDecision.decide`. The description
 * states the budget the deployment actually configured, so the model knows how
 * much state it may pass and how many questions fit one call.
 *
 * @module dsh-laya-go-decision/host/tools/decide
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { LayaGoDecisionService } from '../service.ts'
import { millis, nearestLevel, numberOf, round } from './format.ts'

/** The canonical answer shape the renderer reads; leaves stay `JsonValue`. */
interface RenderableAnswer {
  readonly id: string
  readonly type: string
  readonly choice?: string | undefined
  readonly score?: number | undefined
  readonly noul?: number | undefined
  readonly legend?: unknown
  readonly probabilities?: unknown
  readonly confidence: number
  readonly certain: boolean
}

/** Render one answered question for the model. */
function describeAnswer(answer: RenderableAnswer): string {
  const marker = answer.certain ? 'certain' : 'UNCERTAIN'
  const confidence = `confidence ${round(answer.confidence, 3)}`
  if (answer.type === 'choice') {
    const probability = numberOf(answer.probabilities, answer.choice)
    return [
      `${answer.id}: choice "${answer.choice ?? 'unknown'}"`,
      probability === undefined ? undefined : `p=${round(probability, 4)}`,
      confidence,
      marker,
    ].filter(part => part !== undefined).join(', ')
  }
  if (answer.type === 'score') {
    const level = nearestLevel(answer.legend, answer.score ?? 0)
    return [
      `${answer.id}: score ${round(answer.score ?? 0, 2)}`,
      level === undefined ? undefined : `closest level "${level}"`,
      confidence,
      marker,
    ].filter(part => part !== undefined).join(', ')
  }
  if (answer.type === 'noul') {
    // `confidence` is max(p, 1-p) for noul, so it grades how sharp the answer is,
    // not how likely "yes" is. Naming the direction keeps a confidently-low
    // probability from reading as a confident risk.
    const probability = answer.noul ?? 0
    const direction = probability >= 0.5 ? 'yes' : 'no'
    return `${answer.id}: noul=${round(probability, 4)}, most likely "${direction}" (${confidence}, ${marker})`
  }
  return `${answer.id}: ${answer.type}, ${confidence}, ${marker}`
}

/**
 * Register `laya_go_decide`.
 * @param ctx - plugin context providing `ctx.tools`.
 * @param service - the decision service.
 */
export function registerDecideTool(ctx: Context, service: LayaGoDecisionService): void {
  const config = service.config
  ctx.tools.register(defineTool({
    name: 'laya_go_decide',
    description: [
      'Answer typed questions about one piece of text with the local Laya Go Launcher model, in one shared forward pass.',
      'Use it for classification, routing, rating, and yes/no checks where a small local model is enough; it cannot write code, plan, or explain reasoning.',
      'Question types: `choice` picks one label from a label-to-description object, `score` rates ordered level descriptions from low to high, `noul` answers a yes/no question.',
      'Prefer one call with every question you have: each extra question costs little against the shared pass.',
      `\`state\` must be at most ${config.maxStateChars} characters, and one call fits at most ${config.maxQuestions} questions; summarize long material instead of passing a transcript, because the model truncates from the right and would drop the newest part.`,
      'Every answer carries `confidence`, which is normalized entropy rather than an accuracy claim: answers reported as `certain: false` are undecided, so decide those yourself or gather more context instead of trusting the label.',
    ].join(' '),
    parameters: {
      state: {
        type: 'string',
        required: true,
        description: 'The text to decide about (a message, ticket, diff summary, log excerpt). Summarize rather than dump.',
      },
      questions: {
        type: 'array',
        required: true,
        description: `Questions to answer in one pass (at most ${config.maxQuestions}).`,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: {
              type: 'string',
              required: true,
              description: 'Short unique id, echoed back in the answer.',
            },
            type: {
              type: 'string',
              required: true,
              enum: ['choice', 'score', 'noul'],
              description: 'choice: pick a label; score: rate ordered levels; noul: yes/no.',
            },
            instructions: {
              type: 'string',
              required: true,
              description: 'The question in natural language.',
            },
            criteria: {
              type: 'json',
              description: 'choice: {"label": "description"}; score: ["low", ..., "high"]; omit for noul.',
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          model: { type: 'string', description: 'Checkpoint that answered, when the launcher reports one.' },
          answers: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                type: { type: 'string', required: true },
                choice: { type: 'string' },
                score: { type: 'number' },
                legend: { type: 'object', additionalProperties: true },
                noul: { type: 'number' },
                probabilities: { type: 'object', additionalProperties: true },
                actProbability: { type: 'number' },
                confidence: { type: 'number', required: true },
                certain: { type: 'boolean', required: true },
              },
            },
          },
          uncertain: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: 'Ids whose confidence is below the deployment threshold.',
          },
          usage: {
            type: 'object',
            additionalProperties: false,
            properties: {
              inputTokens: { type: 'number' },
              outputTokens: { type: 'number' },
            },
          },
          timing: {
            type: 'object',
            additionalProperties: false,
            properties: {
              totalMs: { type: 'number' },
              tokenizeMs: { type: 'number' },
              inferenceMs: { type: 'number' },
            },
          },
          server: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              mode: { type: 'string', required: true },
              baseUrl: { type: 'string', required: true },
              started: { type: 'boolean', required: true },
              adopted: { type: 'boolean', required: true },
            },
          },
          warnings: {
            type: 'array',
            required: true,
            items: { type: 'string' },
          },
        },
      },
      render: (_args, value) => {
        const lines: string[] = []
        const timing = millis(value.timing?.totalMs)
        const origin = value.server.started
          ? 'started the launcher for this call'
          : value.server.adopted ? 'used the launcher already running' : 'launcher was already running'
        lines.push([
          `Laya Go Launcher answered ${value.answers.length} question(s)`,
          value.model === undefined ? undefined : `with ${value.model}`,
          timing === undefined ? undefined : `in ${timing}`,
          `(${origin}).`,
        ].filter(part => part !== undefined).join(' '))
        for (const answer of value.answers) lines.push(`- ${describeAnswer(answer)}`)
        if (value.uncertain.length > 0) {
          lines.push([
            `Uncertain answers (confidence below the deployment threshold): ${value.uncertain.join(', ')}.`,
            'Treat those as undecided: answer them yourself or gather more context rather than trusting the label.',
          ].join(' '))
        }
        for (const warning of value.warnings) lines.push(`Warning: ${warning}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    timeoutMs: config.requestTimeoutMs + config.startTimeoutMs + 10_000,
    // One HTTP call with no shared mutable state; concurrent calls are safe.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const result = await service.decide(args.state, args.questions, exec.signal)
      return {
        ...result.model === undefined ? {} : { model: result.model },
        answers: result.answers.map(answer => ({
          id: answer.id,
          type: answer.type,
          ...answer.choice === undefined ? {} : { choice: answer.choice },
          ...answer.score === undefined ? {} : { score: answer.score },
          ...answer.legend === undefined ? {} : { legend: answer.legend },
          ...answer.noul === undefined ? {} : { noul: answer.noul },
          ...answer.probabilities === undefined ? {} : { probabilities: answer.probabilities },
          ...answer.actProbability === undefined ? {} : { actProbability: answer.actProbability },
          confidence: answer.confidence,
          certain: answer.certain,
        })),
        uncertain: [...result.uncertain],
        ...result.usage === undefined ? {} : {
          usage: {
            ...result.usage.inputTokens === undefined ? {} : { inputTokens: result.usage.inputTokens },
            ...result.usage.outputTokens === undefined ? {} : { outputTokens: result.usage.outputTokens },
          },
        },
        ...result.timing === undefined ? {} : {
          timing: {
            ...result.timing.totalMs === undefined ? {} : { totalMs: result.timing.totalMs },
            ...result.timing.tokenizeMs === undefined ? {} : { tokenizeMs: result.timing.tokenizeMs },
            ...result.timing.inferenceMs === undefined ? {} : { inferenceMs: result.timing.inferenceMs },
          },
        },
        server: {
          mode: result.server.mode,
          baseUrl: result.server.baseUrl,
          started: result.server.started,
          adopted: result.server.adopted,
        },
        warnings: [...result.warnings],
      }
    },
  }))
}
