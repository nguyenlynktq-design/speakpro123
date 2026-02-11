
export type CEFRLevel = 'Starters' | 'Movers' | 'Flyers' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface Theme {
  id: string;
  label: string;
  icon: string;
  description: string;
}

export interface VocabularyItem {
  word: string;
  translation: string;
  ipa: string;         // Required - displayed in UI
  icon: string;        // Required - emoji displayed in vocabulary cards
  definition?: string; // Optional - not currently used
}

export interface PresentationData {
  imageUri: string;
  script: string;
  intro: string;
  points: string[];
  conclusion: string;
  level: CEFRLevel;
  lessonVocab: VocabularyItem[]; // Từ vựng mới của bài học
}

export interface EvaluationResult {
  score: number;
  pronunciation: number;
  fluency: number;
  intonation: number;
  vocabulary: number;
  grammar: number;
  taskFulfillment: number;
  perceivedLevel: string;
  mistakes: { word: string; tip: string }[];
  feedback: string;
  teacherPraise: string;
  transcript: string;
  suggestions: string[];
  keyVocabulary: VocabularyItem[];
}

export enum AppStatus {
  IDLE = 'IDLE',
  GENERATING = 'GENERATING',
  READY = 'READY',
  RECORDING = 'RECORDING',
  REVIEWING = 'REVIEWING',
  EVALUATING = 'EVALUATING',
  RESULT = 'RESULT',
  ERROR = 'ERROR'
}
