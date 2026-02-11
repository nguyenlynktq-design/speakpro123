
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { CEFRLevel, EvaluationResult } from "../types";

// ========================================
// API Key Management
// ========================================

/**
 * Get API key with priority: localStorage > environment variable
 * Following AI_INSTRUCTIONS.md: "Ưu tiên sử dụng key từ localStorage"
 */
export function getApiKey(): string {
  // Priority 1: User's key from Settings
  const userKey = localStorage.getItem('speakpro_api_key');
  if (userKey && userKey.trim()) return userKey.trim();

  // Priority 2: Environment variable (dev only - from vite.config.ts)
  const envKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (envKey && envKey.trim()) return envKey.trim();

  throw new Error('⚠️ Chưa có API Key! Vào Settings (⚙️) để nhập key.');
}

/**
 * Create AI client with proper API key
 */
function createAIClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: getApiKey() });
}

// ========================================
// Model Configuration - 2026 Stable Models
// https://ai.google.dev/gemini-api/docs/models
// ========================================
// Free tier limits: 10 RPM, 250 RPD, 250K TPM
// Strategy: Use cheapest model first, minimize retries

const MODEL_FALLBACK_CHAIN = [
  'gemini-2.5-flash-lite',     // Primary: Cheapest, optimized for high-throughput
  'gemini-2.5-flash',          // Fallback: Fast, best price-performance
];

type ModelType = 'text' | 'image';

// ========================================
// Rate Limiter - Prevent exceeding 10 RPM
// ========================================
const requestTimestamps: number[] = [];
const MAX_RPM = 8; // Stay under 10 RPM limit with buffer

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  // Remove timestamps older than 60 seconds
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - 60000) {
    requestTimestamps.shift();
  }

  if (requestTimestamps.length >= MAX_RPM) {
    const waitTime = requestTimestamps[0] + 60000 - now + 500; // Wait until oldest request expires + buffer
    console.log(`[Rate Limiter] Approaching limit (${requestTimestamps.length}/${MAX_RPM} RPM), waiting ${waitTime}ms...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  requestTimestamps.push(Date.now());
}

// ========================================
// Model Fallback System
// ========================================
async function callWithModelFallback<T>(
  fn: (model: string) => Promise<T>,
  modelType: ModelType = 'text',
  maxRetries = 2  // Reduced from 3 to save quota
): Promise<T> {
  // Use text models for image generation - they support it natively!
  // gemini-2.5-flash-image NOT available in free tier, causes quota errors
  const models = MODEL_FALLBACK_CHAIN;

  let lastError: any;

  for (const model of models) {
    let delay = 3000; // Start with longer delay to respect rate limits

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await waitForRateLimit(); // Enforce rate limiting
        console.log(`[API] ${model} (attempt ${attempt + 1}/${maxRetries})`);
        return await fn(model);
      } catch (err: any) {
        lastError = err;
        const errorStr = JSON.stringify(err).toLowerCase();
        const isNotFound = err?.status === 404 || errorStr.includes('not_found');
        const isRateLimit = err?.status === 429 || errorStr.includes('quota') || errorStr.includes('rate limit') || errorStr.includes('resource_exhausted');
        const isServerError = err?.status >= 500 || errorStr.includes('internal error');

        // If model not found, skip to next model immediately (don't waste retries)
        if (isNotFound) {
          console.log(`[API] ${model} not found, skipping to next model`);
          break;
        }

        // If rate limit, use longer delay before retry
        if (isRateLimit && attempt < maxRetries - 1) {
          const rateLimitDelay = delay * 2;
          console.log(`[API] Rate limited, waiting ${rateLimitDelay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, rateLimitDelay));
          delay *= 2;
          continue;
        }

        // If server error, retry with normal delay
        if (isServerError && attempt < maxRetries - 1) {
          console.log(`[API] Server error (${err?.status}), retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }

        // Try next model if available
        if (models.indexOf(model) < models.length - 1) {
          console.log(`[API] ${model} failed, trying next model`);
          break;
        }

        throw err;
      }
    }
  }

  throw new Error(`⚠️ API Key hết quota!\n\nHãy:\n1. Nhấn nút ⚙️ để đổi key mới\n2. Hoặc chờ 1 phút rồi thử lại`);
}

export const generateIllustration = async (theme: string): Promise<string> => {
  return callWithModelFallback(async (model) => {
    const ai = createAIClient(); // Use helper with localStorage priority
    const prompt = `A vibrant, very colorful, high-quality 3D Pixar style illustration for children: ${theme}. Bright saturated colors, happy characters, 16:9 ratio.`;
    const response = await ai.models.generateContent({
      model, // Use dynamic model from fallback
      contents: { parts: [{ text: prompt }] },
      config: { imageConfig: { aspectRatio: "16:9" } }
    });
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
    throw new Error("❌ Không thể tạo ảnh minh họa.\n\nVui lòng thử lại hoặc chọn chủ đề khác.");
  }, 'image');
};

export const generatePresentationScript = async (imageUri: string, theme: string, level: CEFRLevel): Promise<any> => {
  return callWithModelFallback(async (model) => {
    const ai = createAIClient(); // Use helper with localStorage priority
    const levelConstraints: Record<string, string> = {
      'Starters': 'Strictly 20 words. Grammar: Extremely simple nouns/verbs. Example: "I see a cat. It is red."',
      'Movers': 'Strictly 50 words. Grammar: Simple present, clear sentences.',
      'Flyers': 'Strictly 80 words. Grammar: Present continuous, basic conjunctions.',
      'A1': '100-120 words. Grammar: Basic daily routine, simple compound sentences.',
      'A2': '150-180 words. Grammar: Past simple, linking words (because, so).',
      'B1': '200-250 words. Grammar: Relative clauses, expressing opinions.',
      'B2': '250-300 words. Grammar: Passive voice, conditionals.'
    };

    // Build prompt parts based on whether image is provided
    const parts: any[] = [];

    if (imageUri && imageUri.length > 0) {
      parts.push({ inlineData: { mimeType: 'image/png', data: imageUri.split(',')[1] } });
      parts.push({
        text: `Create an English presentation script for a child at ${level} level about this image. 
               Theme: "${theme}".
               CONSTRAINTS: ${levelConstraints[level]}.
               Return JSON with "intro", "points" (array), "conclusion", and "lessonVocab" (array of {word, ipa, translation, icon}).
               MANDATORY: "translation" MUST BE IN VIETNAMESE. "icon" is a single emoji.`
      });
    } else {
      parts.push({
        text: `Create an English presentation script for a child at ${level} level about "${theme}". 
               CONSTRAINTS: ${levelConstraints[level]}.
               Return JSON with "intro", "points" (array), "conclusion", and "lessonVocab" (array of {word, ipa, translation, icon}).
               MANDATORY: "translation" MUST BE IN VIETNAMESE. "icon" is a single emoji.`
      });
    }

    const response = await ai.models.generateContent({
      model, // Use dynamic model from fallback
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intro: { type: Type.STRING },
            points: { type: Type.ARRAY, items: { type: Type.STRING } },
            conclusion: { type: Type.STRING },
            lessonVocab: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  word: { type: Type.STRING },
                  ipa: { type: Type.STRING },
                  translation: { type: Type.STRING },
                  icon: { type: Type.STRING }
                },
                required: ["word", "ipa", "translation", "icon"]
              }
            }
          }
        }
      }
    });

    return JSON.parse(response.text || '{}');
  });
};

export const generateTeacherVoice = async (text: string): Promise<AudioBuffer> => {
  // TTS doesn't need fallback - it uses a specific stable model
  try {
    const ai = createAIClient(); // Use helper with localStorage priority
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts", // TTS model is specific, doesn't use fallback
      contents: [{ parts: [{ text: `Slow, clear, friendly English for kids: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
      },
    });
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    return await decodeAudioData(decode(base64Audio!), audioContext, 24000, 1);
  } catch (err: any) {
    throw new Error(`Lỗi tạo giọng nói: ${err?.message || 'Unknown error'}`);
  }
};

export const evaluatePresentation = async (originalScript: string, audioBase64: string, audioMimeType: string, level: CEFRLevel): Promise<EvaluationResult> => {
  return callWithModelFallback(async (model) => {
    const ai = createAIClient(); // Use helper with localStorage priority
    const response = await ai.models.generateContent({
      model, // Use dynamic model from fallback chain
      contents: {
        parts: [
          { inlineData: { mimeType: audioMimeType, data: audioBase64 } },
          {
            text: `Evaluate this child's English presentation. 
                   Expected script: "${originalScript}"
                   Level: ${level}.
                   
                   INSTRUCTIONS:
                   1. Listen carefully to the audio. It is a child speaking, so allow for some hesitation or background noise.
                   2. Scale all criteria from 0 to 10.
                   3. If you can hear the child trying to speak parts of the script, DO NOT give 0. Give points based on effort and accuracy.
                   4. ONLY give 0 if the audio is completely silent, or contains NO English words at all.
                   5. Provide encouraging feedback in VIETNAMESE.
                   
                   Return JSON.` }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transcript: { type: Type.STRING },
            pronunciation: { type: Type.NUMBER },
            fluency: { type: Type.NUMBER },
            intonation: { type: Type.NUMBER },
            vocabulary: { type: Type.NUMBER },
            grammar: { type: Type.NUMBER },
            taskFulfillment: { type: Type.NUMBER },
            feedback: { type: Type.STRING },
            teacherPraise: { type: Type.STRING },
            suggestions: { type: Type.ARRAY, items: { type: Type.STRING } }
          }
        }
      }
    });
    const raw = JSON.parse(response.text || '{}');
    // Ensure scores are in 0-10 range and rounded
    const normalize = (val: number | undefined) => {
      const num = val || 0;
      return Math.min(10, Math.max(0, Math.round(num * 10) / 10));
    };

    const evalResult = {
      ...raw,
      pronunciation: normalize(raw.pronunciation),
      fluency: normalize(raw.fluency),
      intonation: normalize(raw.intonation),
      vocabulary: normalize(raw.vocabulary),
      grammar: normalize(raw.grammar),
      taskFulfillment: normalize(raw.taskFulfillment),
    };

    const avg = (evalResult.pronunciation + evalResult.fluency + evalResult.intonation + evalResult.vocabulary + evalResult.grammar + evalResult.taskFulfillment) / 6;
    const score = normalize(avg);
    return { ...evalResult, score, perceivedLevel: level, keyVocabulary: [], mistakes: [] };
  });
};

export function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

export async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
}
