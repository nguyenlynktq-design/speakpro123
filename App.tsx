
import React, { useState, useRef, useEffect } from 'react';

import { Theme, AppStatus, PresentationData, EvaluationResult, CEFRLevel, VocabularyItem } from './types';
import { PREDEFINED_THEMES, CEFR_LEVELS } from './constants';
import {
  generateIllustration,
  generatePresentationScript,
  generateTeacherVoice,
  evaluatePresentation,
  getApiKey // Import helper for API key management
} from './services/geminiService';
import ThemeCard from './components/ThemeCard';
import {
  Mic, Play, Pause, RotateCcw, Sparkles, Wand2,
  Trophy, ArrowRight, MessageCircle,
  ShieldCheck, StopCircle, CheckCircle2, AlertTriangle, HelpCircle, X, Download, Medal, BookOpen, Volume2, Settings2, Printer, Star, FileAudio, ImageIcon, Frown
} from 'lucide-react';

const App: React.FC = () => {
  const [selectedTheme, setSelectedTheme] = useState<Theme | null>(null);
  const [customTheme, setCustomTheme] = useState('');
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<PresentationData | null>(null);
  const [childName, setChildName] = useState('Leo');
  const [level, setLevel] = useState<CEFRLevel>('Starters');
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [audioState, setAudioState] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [showCertificate, setShowCertificate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');


  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [isReplayingRecorded, setIsReplayingRecorded] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [teacherAudioUrl, setTeacherAudioUrl] = useState<string | null>(null);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedApiKey = localStorage.getItem('speakpro_api_key');
    if (savedApiKey) setApiKey(savedApiKey);

    // 🔑 UX Improvement: Auto-show Settings if no API key exists
    // Check both localStorage and env variable
    const hasApiKey = savedApiKey || process.env.API_KEY;
    if (!hasApiKey) {
      // Delay slightly to avoid jarring immediate modal on first load
      setTimeout(() => setShowSettings(true), 500);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (sourceNodeRef.current) sourceNodeRef.current.stop();
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      if (teacherAudioUrl) URL.revokeObjectURL(teacherAudioUrl);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (audioPlayerRef.current) audioPlayerRef.current.pause();
    };
  }, [recordedUrl, teacherAudioUrl]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const renderEnhancedScript = (text: string, sectionColor: string) => {
    if (!presentation) return null;
    const words = text.split(' ');
    const vocabWords = presentation.lessonVocab.map(v => v.word.toLowerCase());
    return words.map((word, i) => {
      const cleanWord = word.toLowerCase().replace(/[.,!?;:"]/g, '');
      const isNewWord = vocabWords.includes(cleanWord);
      return (
        <span key={i} className={`${isNewWord ? 'text-orange-600 font-black border-b-2 border-orange-200' : sectionColor}`}>
          {word}{' '}
        </span>
      );
    });
  };

  const generateAudioForDownload = async (text: string) => {
    try {
      const buffer = await generateTeacherVoice(text);
      // Convert AudioBuffer to WAV blob for download
      const numChannels = buffer.numberOfChannels;
      const sampleRate = buffer.sampleRate;
      const length = buffer.length;
      const arrayBuffer = new ArrayBuffer(44 + length * numChannels * 2);
      const view = new DataView(arrayBuffer);

      // WAV header
      const writeString = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
      writeString(0, 'RIFF');
      view.setUint32(4, 36 + length * numChannels * 2, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * numChannels * 2, true);
      view.setUint16(32, numChannels * 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, length * numChannels * 2, true);

      // Audio data
      let offset = 44;
      for (let i = 0; i < length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
          const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
          view.setInt16(offset, sample * 0x7FFF, true);
          offset += 2;
        }
      }

      const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
      setTeacherAudioUrl(URL.createObjectURL(blob));
    } catch (e) {
      console.error("Audio generation for download failed", e);
    }
  };

  const handleGenerate = async () => {
    const themeText = customTheme || selectedTheme?.label;
    if (!themeText) return;
    try {
      setStatus(AppStatus.GENERATING);
      setErrorMessage(null);

      // Generate image first (required for script context)
      const img = await generateIllustration(themeText);

      // Then generate script with image context
      const scriptData = await generatePresentationScript(img, themeText, level);

      const fullScript = `${scriptData.intro} ${scriptData.points.join(' ')} ${scriptData.conclusion}`;
      setPresentation({
        imageUri: img, ...scriptData,
        script: fullScript,
        level
      });
      setStatus(AppStatus.READY);

      // Generate audio in background without blocking UI (optimization kept)
      generateAudioForDownload(fullScript).catch(e => console.warn('Audio preload failed', e));
    } catch (err: any) {
      const errorMsg = err?.message || "Oops! Có lỗi rồi bé ơi.";
      console.error('[SpeakPro Error]', err);
      setErrorMessage(errorMsg);
      setStatus(AppStatus.ERROR);
    }
  };

  const playVoice = async (text: string) => {
    if (isAudioLoading) return;
    try {
      setIsAudioLoading(true);
      if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const buffer = await generateTeacherVoice(text);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = playbackSpeed;
      source.connect(audioContextRef.current.destination);
      source.start(0);
      source.onended = () => { if (text === presentation?.script) setAudioState('idle'); };
      if (text === presentation?.script) {
        sourceNodeRef.current = source;
        setAudioState('playing');
      }
    } catch (err) { console.error(err); } finally { setIsAudioLoading(false); }
  };

  const stopMainAudio = () => {
    if (sourceNodeRef.current) { sourceNodeRef.current.stop(); sourceNodeRef.current = null; }
    setAudioState('idle');
  };

  const startRecording = async () => {
    setRecordedBlob(null);
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(null);
    setRecordingTime(0);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000
        }
      });
      setStatus(AppStatus.RECORDING);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000
      });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        if (audioChunksRef.current.length === 0) {
          alert("Không có dữ liệu âm thanh. Bé hãy thử lại nhé!");
          setStatus(AppStatus.READY);
          return;
        }
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        setRecordedBlob(blob);
        setRecordedUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start(); // Using standard start for a single continuous recording
      timerIntervalRef.current = window.setInterval(() => setRecordingTime(p => p + 1), 1000);
    } catch (err) {
      alert("Bé ơi, hãy cho phép dùng Microphone nhé!");
      setStatus(AppStatus.READY);
    }
  };

  const stopRecording = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setStatus(AppStatus.REVIEWING);
  };

  const playRecordedAudio = () => {
    if (!recordedUrl) return;
    if (isReplayingRecorded) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current.currentTime = 0;
      }
      setIsReplayingRecorded(false);
    } else {
      const audio = new Audio(recordedUrl);
      audioPlayerRef.current = audio;
      audio.volume = 1.0; // Ensure full volume for clear playback
      audio.onplay = () => setIsReplayingRecorded(true);
      audio.onended = () => setIsReplayingRecorded(false);
      audio.onerror = (e) => {
        console.error('Audio playback error:', e);
        alert("Lỗi phát lại. Hãy thử thu âm lại!");
        setIsReplayingRecorded(false);
      };
      audio.play().catch(e => {
        console.error('Play failed:', e);
        alert("Lỗi phát lại. Hãy thử thu âm lại!");
        setIsReplayingRecorded(false);
      });
    }
  };

  const handleSubmitEvaluation = async () => {
    if (!recordedBlob || recordedBlob.size < 1000) {
      alert("Bản ghi âm quá ngắn hoặc trống. Bé hãy thử nói lại nhé!");
      return;
    }
    setStatus(AppStatus.EVALUATING);
    try {
      const base64 = await new Promise<string>((res) => {
        const reader = new FileReader();
        reader.onloadend = () => res((reader.result as string).split(',')[1]);
        reader.readAsDataURL(recordedBlob);
      });
      const evalRes = await evaluatePresentation(presentation!.script, base64, recordedBlob.type, level);
      setResult(evalRes);
      setStatus(AppStatus.RESULT);
    } catch (err: any) {
      setErrorMessage(`❌ Lỗi khi chấm bài\n\n${err?.message || 'Vui lòng thử ghi âm lại hoặc kiểm tra API Key.'}`);
      setStatus(AppStatus.ERROR);
    }
  };

  const reset = () => {
    setSelectedTheme(null); setPresentation(null); setResult(null); setStatus(AppStatus.IDLE);
    setRecordedBlob(null); setRecordedUrl(null); setTeacherAudioUrl(null);
  };

  const downloadImage = () => {
    if (!presentation) return;
    const link = document.createElement('a');
    link.href = presentation.imageUri;
    link.download = `presentation-${childName}.png`;
    link.click();
  };

  const saveSettings = () => {
    if (!apiKey.trim()) {
      alert('Vui lòng nhập API Key!');
      return;
    }
    localStorage.setItem('speakpro_api_key', apiKey.trim());

    // 🔑 CRITICAL: Clear error and allow retry (following SKILL.md)
    if (errorMessage) {
      setErrorMessage(null);
      // If in ERROR state, reset to appropriate state for retry
      if (status === AppStatus.ERROR) {
        // If there's a presentation, allow retry from READY state
        if (presentation) {
          setStatus(AppStatus.READY);
        } else {
          // Otherwise, start fresh
          setStatus(AppStatus.IDLE);
        }
      }
    }

    setShowSettings(false);
    alert('✅ Đã lưu cài đặt thành công! Bạn có thể thử lại ngay.');
  };

  // No longer needed - using getApiKey() from service

  return (
    <div className="min-h-screen bg-[#fffcf5] pb-20 font-['Quicksand'] relative overflow-x-hidden text-slate-700">
      <header className="bg-white/80 backdrop-blur-xl border-b-4 border-orange-100 sticky top-0 z-50 px-6 py-4 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer group" onClick={reset}>
            <div className="bg-gradient-to-tr from-orange-500 to-yellow-400 p-2.5 rounded-[1.2rem] shadow-xl group-hover:rotate-12 transition-all">
              <Sparkles className="text-white" size={24} />
            </div>
            <h1 className="text-2xl font-black text-orange-500 tracking-tighter">Speakpro</h1>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => setShowSettings(true)} className="p-3 bg-orange-50 rounded-xl text-slate-400 hover:text-orange-500 shadow-md transition-all" title="Cài đặt"><Settings2 size={20} /></button>
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Học sinh</span>
              <input type="text" value={childName} onChange={e => setChildName(e.target.value)} className="bg-transparent border-none outline-none font-black text-slate-800 w-24 text-right text-sm" />
            </div>
            <div className="w-px h-8 bg-orange-100 mx-2" />
            <select value={level} onChange={e => setLevel(e.target.value as CEFRLevel)} className="bg-orange-50 px-4 py-2 rounded-xl font-black text-blue-500 outline-none text-xs uppercase tracking-widest cursor-pointer">
              {CEFR_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 mt-10">
        {status === AppStatus.IDLE && (
          <div className="space-y-16 animate-in fade-in slide-in-from-bottom-5 duration-700">
            <div className="text-center space-y-4">
              <h2 className="text-5xl md:text-6xl font-black text-slate-800 leading-tight tracking-tighter">Chọn chủ đề bé yêu thích ✨</h2>
              <div className="max-w-3xl mx-auto pt-6 relative">
                <input type="text" placeholder="Hoặc gõ chủ đề bất kỳ: Unicorn, Robot..." className="w-full px-10 py-6 rounded-[2.5rem] border-8 border-orange-50 focus:border-orange-200 outline-none shadow-xl text-xl font-black placeholder:text-slate-300 transition-all" value={customTheme} onChange={(e) => setCustomTheme(e.target.value)} />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 p-4 bg-orange-400 rounded-3xl text-white shadow-lg cursor-pointer hover:scale-110 transition-all"><Wand2 size={28} /></div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
              {PREDEFINED_THEMES.map((t) => <ThemeCard key={t.id} theme={t} isSelected={selectedTheme?.id === t.id} onClick={(theme) => { setSelectedTheme(theme); setCustomTheme(''); }} />)}
            </div>
            <div className="flex justify-center"><button disabled={!selectedTheme && !customTheme} onClick={handleGenerate} className="px-16 py-6 rounded-[2rem] font-black text-2xl shadow-xl bg-gradient-to-r from-orange-500 to-yellow-500 text-white hover:scale-105 active:scale-95 transition-all flex items-center gap-4 border-b-4 border-orange-700">Tạo bài học ngay <ArrowRight size={32} /></button></div>
          </div>
        )}

        {/* ERROR STATE - with retry mechanism following SKILL.md */}
        {status === AppStatus.ERROR && errorMessage && (
          <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-8">
            <div className="w-40 h-40 bg-red-50 rounded-[3rem] flex items-center justify-center shadow-xl border-4 border-white">
              <AlertTriangle size={80} className="text-red-500" />
            </div>
            <div className="max-w-2xl bg-red-50 border-4 border-red-100 rounded-[3rem] p-10 text-center space-y-6">
              <h3 className="text-3xl font-black text-red-600">Ối! Có lỗi rồi</h3>
              <p className="text-xl text-slate-700 font-bold whitespace-pre-line leading-relaxed">
                {errorMessage}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
                <button
                  onClick={() => setShowSettings(true)}
                  className="px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-black text-lg shadow-lg transition-all flex items-center gap-3 justify-center"
                >
                  <Settings2 size={24} /> Đổi API Key
                </button>
                {/* Retry button - only show if we have presentation (mid-process error) */}
                {presentation && (
                  <button
                    onClick={() => {
                      setErrorMessage(null);
                      setStatus(AppStatus.READY);
                    }}
                    className="px-8 py-4 bg-blue-500 hover:bg-blue-600 text-white rounded-2xl font-black text-lg shadow-lg transition-all flex items-center gap-3 justify-center"
                  >
                    <RotateCcw size={24} /> Thử lại
                  </button>
                )}
                {/* Start over button */}
                <button
                  onClick={reset}
                  className="px-8 py-4 bg-slate-500 hover:bg-slate-600 text-white rounded-2xl font-black text-lg shadow-lg transition-all flex items-center gap-3 justify-center"
                >
                  <ArrowRight size={24} /> Bài mới
                </button>
              </div>
            </div>
          </div>
        )}

        {status === AppStatus.GENERATING && (
          <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-8">
            <div className="w-40 h-40 bg-yellow-50 rounded-[3rem] flex items-center justify-center animate-bounce shadow-xl border-4 border-white"><Sparkles size={80} className="text-yellow-400" /></div>
            <h3 className="text-3xl font-black text-slate-800 text-center">Chờ cô Ly một xíu nhé... 🎨</h3>
            <p className="text-sm text-slate-500 font-bold mt-2">Đang dùng model: <span className="text-orange-500">gemini-2.5-flash-lite</span></p>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span>Hệ thống sẽ tự động thử model khác nếu gặp lỗi</span>
            </div>
          </div>
        )}

        {(status === AppStatus.READY || status === AppStatus.RECORDING || status === AppStatus.REVIEWING) && presentation && (
          <div className="animate-in fade-in duration-700 space-y-10 pb-40">
            <div className="bg-white rounded-[3rem] shadow-2xl border-8 border-orange-100 overflow-hidden flex flex-col min-h-[70vh]">
              <div className="bg-orange-50/50 px-10 py-6 border-b-4 border-dashed border-orange-100 flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="w-16 h-16 bg-white rounded-full border-4 border-orange-200 overflow-hidden flex items-center justify-center text-3xl shadow-sm">👦</div>
                  <div>
                    <h2 className="text-3xl font-black text-slate-800 leading-none">Hello! My name is {childName}.</h2>
                    <p className="text-blue-500 font-bold mt-1 uppercase tracking-widest text-sm">Today, I will talk about this picture.</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <button onClick={downloadImage} className="p-4 bg-white rounded-2xl text-slate-400 hover:text-blue-500 shadow-md transition-all flex items-center gap-2 font-bold text-sm"><ImageIcon size={20} /> Tải ảnh</button>
                  {teacherAudioUrl && (
                    <a href={teacherAudioUrl} download={`teacher-voice-${childName}.wav`} className="p-4 bg-white rounded-2xl text-slate-400 hover:text-orange-500 shadow-md transition-all flex items-center gap-2 font-bold text-sm">
                      <FileAudio size={20} /> Tải bài mẫu
                    </a>
                  )}
                </div>
              </div>

              <div className="flex flex-col lg:flex-row flex-1">
                <div className="lg:w-1/2 p-8 border-r-4 border-dashed border-orange-50">
                  <div className="w-full h-full min-h-[350px] rounded-[2rem] overflow-hidden shadow-lg border-4 border-white bg-slate-50 flex items-center justify-center">
                    <img src={presentation.imageUri} className="w-full h-full object-cover" alt="Illustration" />
                  </div>
                </div>

                <div className="lg:w-1/2 p-10 bg-[#fffdfa] relative">
                  <div className="absolute top-6 right-6 flex items-center gap-3">
                    <button onClick={() => audioState === 'playing' ? stopMainAudio() : playVoice(presentation.script)} className="w-14 h-14 bg-orange-500 text-white rounded-2xl flex items-center justify-center shadow-lg hover:scale-110 transition-all">
                      {isAudioLoading ? <div className="w-6 h-6 border-4 border-white border-t-transparent animate-spin rounded-full" /> : audioState === 'playing' ? <Pause size={28} /> : <Play size={28} />}
                    </button>
                    <select value={playbackSpeed} onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))} className="bg-white border-2 border-orange-100 px-3 py-2 rounded-xl font-bold text-xs outline-none cursor-pointer">
                      <option value="0.8">Chậm</option>
                      <option value="1.0">Vừa</option>
                      <option value="1.2">Nhanh</option>
                    </select>
                  </div>

                  <div className="space-y-5 pt-10 overflow-y-auto max-h-[500px] pr-2">
                    <p className="text-xl font-bold leading-relaxed text-blue-600 italic">
                      {renderEnhancedScript(presentation.intro, "text-blue-600")}
                    </p>
                    <ul className="space-y-3">
                      {presentation.points.map((p, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <div className="w-2 h-2 bg-orange-400 rounded-full mt-2 shrink-0" />
                          <p className="text-lg font-bold leading-relaxed text-slate-700">
                            {renderEnhancedScript(p, "text-slate-700")}
                          </p>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xl font-bold leading-relaxed text-pink-600 italic border-t-2 border-dashed border-pink-100 pt-5 mt-4">
                      {renderEnhancedScript(presentation.conclusion, "text-pink-600")}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50/80 p-8 border-t-4 border-orange-100">
                <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><BookOpen size={16} /> Từ vựng của bài</h4>
                <div className="flex flex-wrap gap-4">
                  {presentation.lessonVocab.map((v, i) => (
                    <div key={i} className="bg-white px-5 py-3 rounded-2xl shadow-sm border-2 border-orange-50 flex items-center gap-4 hover:border-orange-200 transition-all">
                      <span className="text-2xl">{v.icon}</span>
                      <div>
                        <p className="font-black text-slate-800 leading-none text-sm">{v.word} <span className="text-[10px] text-slate-300 font-bold italic">/{v.ipa}/</span></p>
                        <p className="text-[10px] font-bold text-orange-500 uppercase mt-1">{v.translation}</p>
                      </div>
                      <button onClick={() => playVoice(v.word)} className="text-slate-200 hover:text-orange-500 transition-colors"><Volume2 size={16} /></button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] w-full max-w-2xl px-6">
              {status === AppStatus.READY && (
                <button onClick={startRecording} className="w-full bg-gradient-to-r from-orange-500 to-yellow-500 text-white py-8 rounded-[2.5rem] font-black text-3xl flex items-center justify-center gap-6 shadow-2xl hover:-translate-y-2 transition-all border-4 border-white">
                  <Mic size={40} /> Bé hãy nhấn để nói! 🎤
                </button>
              )}
              {status === AppStatus.RECORDING && (
                <div className="flex flex-col gap-4 animate-in slide-in-from-bottom-5">
                  <div className="bg-white/95 backdrop-blur-md border-4 border-red-100 p-6 rounded-[2rem] shadow-xl flex items-center justify-between">
                    <div className="flex items-center gap-4"><div className="w-4 h-4 bg-red-500 rounded-full animate-ping" /><p className="font-black text-slate-800 uppercase tracking-tighter text-lg">ĐANG NGHE BÉ... {formatTime(recordingTime)}</p></div>
                    <button onClick={stopRecording} className="bg-red-600 text-white px-8 py-3 rounded-2xl font-black text-lg shadow-lg hover:bg-red-700 transition-all flex items-center gap-2"><StopCircle size={24} /> XONG!</button>
                  </div>
                </div>
              )}
              {status === AppStatus.REVIEWING && (
                <div className="bg-white/95 backdrop-blur-md border-4 border-blue-100 p-6 rounded-[3rem] shadow-2xl grid grid-cols-3 gap-6">
                  <button onClick={playRecordedAudio} className={`flex flex-col items-center gap-2 py-4 rounded-2xl transition-all ${isReplayingRecorded ? 'bg-blue-100 text-blue-700' : 'bg-slate-50'}`}>{isReplayingRecorded ? <Pause size={32} /> : <Play size={32} />} <span className="text-[10px] font-black">NGHE LẠI</span></button>
                  <button onClick={startRecording} className="flex flex-col items-center gap-2 py-4 rounded-2xl bg-pink-50 text-pink-500 hover:bg-pink-100"><RotateCcw size={32} /> <span className="text-[10px] font-black">THU LẠI</span></button>
                  <button onClick={handleSubmitEvaluation} className="flex flex-col items-center gap-2 py-4 rounded-2xl bg-orange-500 text-white shadow-lg hover:scale-105 transition-all"><CheckCircle2 size={32} /> <span className="text-[10px] font-black uppercase tracking-widest">CHẤM BÀI</span></button>
                </div>
              )}
            </div>
          </div>
        )}

        {status === AppStatus.EVALUATING && (
          <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-8">
            <div className="w-32 h-32 border-8 border-blue-50 border-t-blue-500 rounded-full animate-spin shadow-xl"></div>
            <h3 className="text-3xl font-black text-slate-800 text-center uppercase tracking-widest">Cô Ly đang chấm bài... 💓</h3>
          </div>
        )}

        {status === AppStatus.RESULT && result && (
          <div className="animate-in zoom-in-95 duration-1000 space-y-12 pb-20">
            <div className="bg-white rounded-[4rem] shadow-2xl overflow-hidden border-8 border-orange-100">
              <div className={`p-16 text-center text-white relative bg-gradient-to-br ${result.score > 3 ? 'from-orange-400 to-yellow-500' : 'from-slate-400 to-slate-500'}`}>
                {result.score > 3 ? <Trophy size={140} className="mx-auto text-yellow-200 drop-shadow-2xl animate-bounce mb-6" /> : <Frown size={140} className="mx-auto text-slate-200 drop-shadow-2xl mb-6" />}
                <h2 className="text-6xl font-black mb-4 tracking-tighter uppercase italic">{result.score > 5 ? 'QUÁ TUYỆT VỜI!' : result.score > 0 ? 'CỐ GẮNG LÊN!' : 'CÔ CHƯA NGHE RÕ'}</h2>
                <p className="text-2xl font-bold italic text-orange-50 max-w-2xl mx-auto leading-relaxed">"{result.teacherPraise}"</p>
              </div>

              <div className="p-12 lg:p-20 grid md:grid-cols-2 gap-16">
                <div className="space-y-12">
                  <h4 className="text-3xl font-black text-slate-800 flex items-center gap-4"><MessageCircle size={40} className="text-blue-500" /> Nhận xét của cô</h4>
                  <p className="text-2xl text-slate-700 leading-relaxed font-black italic bg-blue-50/40 p-10 rounded-[3rem] shadow-inner border-2 border-blue-50">"{result.feedback}"</p>
                  <div className="grid grid-cols-2 gap-6">
                    {[{ l: 'Phát âm', s: result.pronunciation, c: 'blue' }, { l: 'Trôi chảy', s: result.fluency, c: 'pink' }, { l: 'Ngữ điệu', s: result.intonation, c: 'orange' }, { l: 'Từ vựng', s: result.vocabulary, c: 'green' }].map(i => (
                      <div key={i.l} className={`p-8 bg-${i.c}-50 rounded-[2.5rem] border-2 border-${i.c}-100 text-center shadow-md`}><p className={`text-4xl font-black text-${i.c}-500`}>{i.s}/10</p><p className="text-[10px] font-black text-slate-400 uppercase mt-2 tracking-widest">{i.l}</p></div>
                    ))}
                  </div>
                </div>
                <div className="space-y-12">
                  <div className="bg-slate-50 p-12 rounded-[4rem] text-center border-4 border-white shadow-xl relative overflow-hidden">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">TỔNG ĐIỂM CỦA BÉ</p>
                    <p className="text-9xl font-black text-orange-500 italic leading-none">{result.score}<span className="text-2xl not-italic">/10</span></p>
                    <button onClick={() => setShowCertificate(true)} disabled={result.score === 0} className="w-full mt-10 py-6 bg-blue-600 text-white disabled:bg-slate-300 rounded-[2rem] font-black text-2xl shadow-xl hover:scale-105 transition-all flex items-center justify-center gap-4"><ShieldCheck size={32} /> NHẬN GIẤY KHEN</button>
                  </div>
                  <div className="space-y-6">
                    <h4 className="text-2xl font-black text-slate-800 flex items-center gap-4"><HelpCircle size={32} className="text-yellow-400" /> Bí quyết giỏi hơn</h4>
                    <div className="space-y-4">{result.suggestions.map((s, i) => <div key={i} className="bg-white border-2 border-slate-50 p-6 rounded-[2rem] flex items-start gap-4 shadow-sm"><div className="bg-blue-500 text-white w-8 h-8 rounded-lg font-black flex items-center justify-center shrink-0">{i + 1}</div><p className="text-lg font-bold text-slate-700 leading-snug">{s}</p></div>)}</div>
                  </div>
                </div>
              </div>

              <div className="p-16 pt-0 flex flex-col sm:flex-row justify-center gap-8">
                <button onClick={() => setStatus(AppStatus.READY)} className="px-12 py-6 rounded-[2rem] font-black text-xl text-slate-400 bg-slate-100 hover:bg-slate-200 transition-all flex items-center gap-4 shadow-md"><RotateCcw size={28} /> THỬ LẠI NHÉ</button>
                <button onClick={reset} className="px-16 py-6 rounded-[2rem] font-black text-2xl bg-gradient-to-r from-blue-600 to-indigo-700 text-white hover:scale-105 shadow-xl transition-all flex items-center gap-4 group">BÀI MỚI THÔI <ArrowRight size={32} /></button>
              </div>
            </div>
          </div>
        )}
      </main>

      {showCertificate && result && (
        <div className="fixed inset-0 z-[500] flex items-start justify-center p-4 bg-slate-900/90 backdrop-blur-xl animate-in fade-in overflow-y-auto pt-10 pb-10" onClick={() => setShowCertificate(false)}>
          <div className="bg-white max-w-4xl w-full rounded-[4rem] shadow-2xl relative animate-in zoom-in-95 border-[16px] border-yellow-100 my-auto" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowCertificate(false)} className="absolute -top-6 -right-6 z-[600] p-4 bg-red-500 text-white rounded-full shadow-2xl hover:scale-110 transition-all border-4 border-white"><X size={32} /></button>
            <div className="p-12 md:p-20 text-center space-y-12 relative z-10">
              <div className="space-y-6">
                <Medal size={120} className="text-yellow-400 mx-auto animate-pulse" />
                <h1 className="text-5xl md:text-7xl font-black text-slate-800 uppercase italic tracking-tighter">GIẤY CHỨNG NHẬN</h1>
                <div className="h-2 w-40 bg-orange-400 mx-auto rounded-full"></div>
                <p className="text-xl font-black text-blue-500 tracking-[0.4em] uppercase">THUYẾT TRÌNH XUẤT SẮC</p>
              </div>
              <div className="space-y-8">
                <p className="text-slate-400 font-black uppercase text-xs tracking-[0.4em]">TRAO TẶNG CHO</p>
                <h2 className="text-6xl md:text-8xl font-black text-blue-800 italic tracking-tight">{childName}</h2>
                <p className="text-slate-500 text-xl md:text-2xl font-bold">Cấp độ: <span className="text-orange-500 font-black">{level}</span> • Kết quả: <span className="text-orange-500 font-black">{result.score}/10</span></p>
              </div>
              <div className="pt-10 flex flex-col items-center gap-4 border-t-4 border-yellow-50 pt-10">
                <p className="text-4xl font-black text-slate-800 italic tracking-tighter">Ms Ly AI</p>
                <p className="text-xs font-black text-blue-300 uppercase tracking-[0.3em]">Hệ thống Speakpro Lab</p>
              </div>
              <div className="flex justify-center gap-6 no-print">
                <button onClick={() => window.print()} className="px-10 py-5 bg-slate-900 text-white rounded-[2rem] font-black text-xl flex items-center gap-3"><Printer size={24} /> IN GIẤY KHEN</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center p-4 bg-slate-900/90 backdrop-blur-xl animate-in fade-in" onClick={() => setShowSettings(false)}>
          <div className="bg-white max-w-md w-full rounded-3xl shadow-2xl relative animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowSettings(false)} className="absolute -top-4 -right-4 z-[610] p-3 bg-red-500 text-white rounded-full shadow-2xl hover:scale-110 transition-all border-4 border-white"><X size={24} /></button>
            <div className="p-8 space-y-6">
              <div className="flex items-center gap-3 pb-4 border-b-2 border-slate-100">
                <div className="p-2 bg-teal-500 rounded-xl"><Settings2 size={24} className="text-white" /></div>
                <h2 className="text-2xl font-black text-slate-800">Cài đặt hệ thống</h2>
              </div>
              <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={20} className="text-blue-500 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-bold text-blue-900 mb-1">Để ứng dụng hoạt động, bạn cần có API Key riêng.</p>
                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold underline hover:text-blue-700">Lấy key tại đây (Miễn phí)</a>
                    <p className="text-xs text-slate-600 mt-2">Hoặc xem hướng dẫn chi tiết: <a href="https://aistudio.google.com/apikey" target="_blank" className="text-blue-600 underline">Tại đây</a></p>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="text-teal-500">🔑</span> Dán API Key của bạn vào</label>
                <input type="text" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="AIza..." className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 transition-all font-mono text-sm" />
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">2. MODEL AI ĐANG SỬ DỤNG</h3>
                <div className="p-4 border-2 rounded-2xl border-teal-400 bg-teal-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-black text-slate-800">Gemini 2.5 Flash Lite</h4>
                        <CheckCircle2 size={20} className="text-teal-500" />
                        <span className="px-2 py-1 bg-teal-500 text-white text-xs font-bold rounded-full">Mặc định</span>
                      </div>
                      <p className="text-sm text-slate-600">Nhanh nhất, tiết kiệm quota nhất, ổn định (Khuyến dùng)</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 border-2 rounded-2xl border-slate-100 bg-slate-50">
                  <div className="flex-1">
                    <h4 className="font-bold text-slate-600 text-sm">Dự phòng: Gemini 2.5 Flash</h4>
                    <p className="text-xs text-slate-500">Tự động dùng khi model chính gặp lỗi</p>
                  </div>
                </div>
                <div className="p-4 border-2 rounded-2xl border-slate-100 bg-slate-50">
                  <div className="flex-1">
                    <h4 className="font-bold text-slate-600 text-sm">Tạo ảnh: Gemini 2.5 Flash Image</h4>
                    <p className="text-xs text-slate-500">Model chuyên tạo ảnh minh họa</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 italic px-2">💡 Hệ thống tự động chuyển model dự phòng nếu gặp lỗi. Free tier: 10 request/phút, 250 request/ngày.</p>
              </div>
              <button onClick={saveSettings} className="w-full py-4 bg-teal-500 hover:bg-teal-600 text-white font-black text-lg rounded-2xl shadow-lg hover:shadow-xl transition-all">Lưu cài đặt</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
