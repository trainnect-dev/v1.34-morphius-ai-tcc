import { anthropic } from '@ai-sdk/anthropic'
import { createAzure } from '@ai-sdk/azure'
import { deepseek } from '@ai-sdk/deepseek'
import { google } from '@ai-sdk/google'
import { groq } from '@ai-sdk/groq'
import { createOpenAI, openai } from '@ai-sdk/openai'
import { xai } from '@ai-sdk/xai'
import {
  createProviderRegistry,
  extractReasoningMiddleware,
  LanguageModelV1 // Import the base type
  ,


  wrapLanguageModel
} from 'ai'
import { createOllama } from 'ollama-ai-provider'

// --- Define the expected type for model IDs based on registered providers ---
type RegisteredProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'groq'
  | 'ollama'
  | 'azure'
  | 'deepseek'
  | 'openai-compatible'
  | 'openrouter'
  | 'xai';

type RegisteredModelId = `${RegisteredProviderId}:${string}`;
// --- End type definition ---

export const registry = createProviderRegistry({
  openai,
  anthropic,
  google,
  groq,
  ollama: createOllama({
    // Ensure OLLAMA_BASE_URL is defined or provide a default
    baseURL: `${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}/api`
  }),
  azure: createAzure({
    // Ensure these are defined or handle missing keys appropriately
    apiKey: process.env.AZURE_API_KEY,
    resourceName: process.env.AZURE_RESOURCE_NAME
  }),
  deepseek,
  'openai-compatible': createOpenAI({
    apiKey: process.env.OPENAI_COMPATIBLE_API_KEY,
    baseURL: process.env.OPENAI_COMPATIBLE_API_BASE_URL
  }),
  openrouter: createOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
  }),
  xai
})

export function getModel(model: string): LanguageModelV1 { // Return type specified
  const [provider, ...modelNameParts] = model.split(':') ?? []
  const modelName = modelNameParts.join(':')

  // Handle Ollama separately (as it might have specific initialization)
  if (provider === 'ollama') {
    const ollama = createOllama({
      baseURL: `${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}/api`
    })
    const ollamaModelInstance = ollama(modelName, { simulateStreaming: true }); // Get instance first

    // Apply reasoning middleware if model ID includes 'deepseek-r1'
    if (modelName.includes('deepseek-r1')) {
      return wrapLanguageModel({
        model: ollamaModelInstance,
        middleware: extractReasoningMiddleware({
          tagName: 'think'
        })
      })
    }
    // Default Ollama handling
    return ollamaModelInstance;
  }

  // --- FIX: Cast 'model' to the expected type ---
  // Get the base model from the registry using the specific type
  const baseModel = registry.languageModel(model as RegisteredModelId);
  // --- End FIX ---

  if (!baseModel) {
      // Handle case where the model ID is not found in the registry
      console.error(`Model with ID "${model}" not found in registry. Falling back to default.`);
      // Fallback to a default model, e.g., OpenAI's mini model
      return registry.languageModel('openai:gpt-4o-mini'); // Ensure this default exists
  }


  // Apply reasoning middleware for specific models/providers
  // Check using the isReasoningModel function
  if (isReasoningModel(model)) {
     return wrapLanguageModel({
       model: baseModel,
       middleware: extractReasoningMiddleware({
         tagName: 'think' // Assuming 'think' is the desired tag for all reasoning models
       })
     })
  }

  // Return the base model if no specific middleware is needed
  return baseModel
}

export function isProviderEnabled(providerId: string): boolean {
  switch (providerId) {
    case 'openai':
      return !!process.env.OPENAI_API_KEY
    case 'anthropic':
      return !!process.env.ANTHROPIC_API_KEY
    case 'google':
      return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
    case 'groq':
      return !!process.env.GROQ_API_KEY
    case 'ollama':
      return !!process.env.OLLAMA_BASE_URL
    case 'azure':
      return !!process.env.AZURE_API_KEY && !!process.env.AZURE_RESOURCE_NAME
    case 'deepseek':
      return !!process.env.DEEPSEEK_API_KEY
    case 'openrouter':
       return !!process.env.OPENROUTER_API_KEY;
    case 'xai':
      return !!process.env.XAI_API_KEY
    case 'openai-compatible':
      return (
        !!process.env.OPENAI_COMPATIBLE_API_KEY &&
        !!process.env.OPENAI_COMPATIBLE_API_BASE_URL
      )
    default:
      // Optionally log unknown provider IDs
      // console.warn(`isProviderEnabled check for unknown providerId: ${providerId}`);
      return false
  }
}

// Helper to get a fallback tool call model safely
function getSafeToolCallModel(preferredModelId: RegisteredModelId): LanguageModelV1 {
    try {
        return getModel(preferredModelId);
    } catch (error) {
        console.warn(`Failed to get preferred tool call model ${preferredModelId}. Falling back. Error: ${error}`);
        // Fallback to a known reliable model like gpt-4o-mini
        return getModel('openai:gpt-4o-mini');
    }
}


export function getToolCallModel(model?: string): LanguageModelV1 { // Return type specified
  const [provider, ...modelNameParts] = model?.split(':') ?? []
  const modelName = modelNameParts.join(':')

  switch (provider) {
    case 'deepseek':
      // Use a model known to be better at tool calls than R1/Reasoner
      return getSafeToolCallModel('deepseek:deepseek-chat');
    case 'groq':
      // Llama 3.1 8B is generally good
      return getSafeToolCallModel('groq:llama-3.1-8b-instant');
    case 'ollama':
      // Ollama tool calling is generally not reliable via SDK, use a default external one
      console.warn("Ollama selected for main task, but using external model for tool call generation.");
      return getSafeToolCallModel('openai:gpt-4o-mini'); // Fallback to OpenAI
    case 'google':
      // Gemini Flash is specified as the fallback in models.json
      return getSafeToolCallModel('google:gemini-2.0-flash');
    case 'openrouter':
       // For OpenRouter, try a generally capable model like Mistral or fall back
       // return getSafeToolCallModel('openrouter:mistralai/mistral-7b-instruct-v0.2'); // Example
       return getSafeToolCallModel('openai:gpt-4o-mini'); // Or stick to OpenAI fallback
    default:
      // Default fallback for OpenAI, Anthropic, Azure, XAI, etc.
      return getSafeToolCallModel('openai:gpt-4o-mini');
  }
}


export function isToolCallSupported(model?: string): boolean {
    if (!model) return false; // Handle undefined case

    const [provider, modelName] = model.split(':') as [RegisteredProviderId | undefined, string | undefined];

    if (!provider || !modelName) return false; // Invalid format

    // Explicitly list providers/models known *not* to support (or reliably support) tool calling
    if (provider === 'ollama' || provider === 'google') {
        // Google models currently require manual tool handling in this setup
        return false;
    }

    // OpenRouter depends on the underlying model. Assume support unless known otherwise.
    if (provider === 'openrouter') {
        // DeepSeek R1 via OpenRouter is unlikely to work well with tools
        return !modelName.includes('deepseek/deepseek-r1');
    }

    // Direct DeepSeek provider checks
    if (provider === 'deepseek') {
        // DeepSeek R1/Reasoner are known not to support tools well
        return !modelName.includes('deepseek-r1') && !modelName.includes('deepseek-reasoner');
    }

    // Default assumption: Providers like OpenAI, Anthropic (newer models), Azure, XAI,
    // and generic OpenAI-Compatible endpoints *should* support native tool calling.
    return true;
}

export function isReasoningModel(model: string): boolean {
  if (typeof model !== 'string') {
    return false
  }
  // Check includes the OpenRouter path for DeepSeek R1 and other known reasoning models
  return (
    model.includes('deepseek-r1') || // Catches Ollama, Groq versions
    model.includes('deepseek/deepseek-r1') || // Catches OpenRouter version
    model.includes('deepseek-reasoner') || // Catches direct DeepSeek provider version
    model.includes('o3-mini') ||
    model.includes('gemini-2.5-pro') || // More specific check for Gemini 2.5 Pro
    model.includes('claude-3-7-sonnet') // More specific check for Claude 3.7
  )
}