
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { CEFRLevel, EvaluationResult } from "../types";

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  let delay = 1500;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const errorStr = JSON.stringify(err).toLowerCase();
      if ((err?.status === 429 || errorStr.includes('quota')) && i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2.5;
        continue;
      }
      throw err;
    }
  }
  throw new Error("MÁY CHỦ BẬN: Bé vui lòng chờ 30 giây rồi nhấn 'Thử lại' nhé!");
}

export const generateIllustration = async (theme: string): Promise<string> => {
  return callWithRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `A vibrant, very colorful, high-quality 3D Pixar style illustration for children: ${theme}. Bright saturated colors, happy characters, 16:9 ratio.`;
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: prompt }] },
      config: { imageConfig: { aspectRatio: "16:9" } }
    });
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
    throw new Error("Không tạo được ảnh.");
  });
};

export const generatePresentationScript = async (imageUri: string, theme: string, level: CEFRLevel): Promise<any> => {
  return callWithRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
      model: 'gemini-3-flash-preview',
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
  return callWithRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Slow, clear, friendly English for kids: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
      },
    });
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    return await decodeAudioData(decode(base64Audio!), audioContext, 24000, 1);
  });
};

export const evaluatePresentation = async (originalScript: string, audioBase64: string, audioMimeType: string, level: CEFRLevel): Promise<EvaluationResult> => {
  return callWithRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
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
