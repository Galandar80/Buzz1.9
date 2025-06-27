import React, { createContext, useContext, useState, useEffect, ReactNode, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  listenToRoom,
  registerBuzz,
  resetBuzz,
  removePlayer,
  joinRoom,
  createRoom,
  checkRoomExists,
  generateRoomCode,
  assignPoints,
  subtractPoints,
  rejectPlayerAnswer,
  database,
  ref,
  update,
  updateRoomActivity,
} from '../services/firebase';
import { AudioStreamManager } from '../services/webrtc';

interface Player {
  name: string;
  isHost: boolean;
  joinedAt: number;
  points?: number;
  team?: 'A' | 'B';
  currentStreak?: number;
  bestStreak?: number;
  correctAnswers?: number;
  wrongAnswers?: number;
  lastAnswerTime?: number;
  averageResponseTime?: number;
}

interface WinnerInfo {
  playerId: string;
  playerName: string;
  timestamp: number;
  answer?: string;
  timeLeft?: number;
}

interface GameMode {
  type: 'classic' | 'speed' | 'marathon' | 'teams';
  name: string;
  description: string;
  settings: GameModeSettings;
}

interface GameModeSettings {
  timeLimit?: number;
  autoNext?: boolean;
  teamsEnabled?: boolean;
  pointsCorrect?: number;
  pointsWrong?: number;
}

export interface GameTimer {
  isActive: boolean;
  timeLeft: number;
  totalTime: number;
}

interface RoomData {
  hostName: string;
  createdAt: number;
  winnerInfo: WinnerInfo | null;
  players: Record<string, Player>;
  playedSongs?: string[];
  gameMode?: GameMode;
  gameTimer?: GameTimer;
  currentSong?: string;
  buzzEnabled?: boolean;
}

interface RoomContextType {
  roomCode: string;
  setRoomCode: React.Dispatch<React.SetStateAction<string>>;
  playerName: string;
  setPlayerName: React.Dispatch<React.SetStateAction<string>>;
  playerId: string;
  setPlayerId: React.Dispatch<React.SetStateAction<string>>;
  roomData: RoomData | null;
  isHost: boolean;
  isLoading: boolean;
  error: string | null;
  playersList: { id: string; name: string; isHost: boolean; points?: number; team?: 'A' | 'B' }[];
  winnerName: string | null;
  handleCreateRoom: (name: string) => Promise<void>;
  handleJoinRoom: (roomCode: string, name: string) => Promise<void>;
  handleBuzz: (playerId?: string, playerName?: string) => Promise<void>;
  handleResetBuzz: () => Promise<void>;
  handleLeaveRoom: () => Promise<void>;
  awardPoints: (amount?: number) => Promise<void>;
  subtractPlayerPoints: (amount?: number) => Promise<void>;
  awardCorrectAnswer: () => Promise<void>;
  awardWrongAnswer: () => Promise<void>;
  awardSuperAnswer: () => Promise<void>;
  rejectAnswer: () => Promise<void>;
  submitAnswer: (answer: string) => Promise<void>;
  audioStreamManager: AudioStreamManager | null;
  setAudioStreamManager: (manager: AudioStreamManager | null) => void;
  setGameMode: (mode: GameMode) => Promise<void>;
  startGameTimer: (seconds: number) => Promise<void>;
  stopGameTimer: () => Promise<void>;
  currentGameMode: GameMode | null;
  gameTimer: GameTimer | null;
  updatePlayerScore: (playerId: string, isCorrect: boolean, responseTime?: number) => Promise<void>;
  calculateScore: (responseTime: number, isCorrect: boolean, streak?: number) => number;
  enableBuzz: () => Promise<void>;
  disableBuzz: () => Promise<void>;
  isBuzzEnabled: boolean;
}

const RoomContext = createContext<RoomContextType | undefined>(undefined);

// Aggiungo interfacce per il sistema di punteggio
export interface PlayerScore {
  playerId: string;
  playerName: string;
  totalScore: number;
  correctAnswers: number;
  wrongAnswers: number;
  currentStreak: number;
  bestStreak: number;
  averageResponseTime: number;
  lastAnswerTime?: number;
}

export interface ScoreSettings {
  basePoints: number;
  speedBonus: number;
  streakMultiplier: number;
  maxSpeedBonus: number;
  penaltyPoints: number;
}

export interface ScoreHistory {
  playerId: string;
  points: number;
  reason: string;
  timestamp: number;
  responseTime?: number;
}

function RoomProvider({ children }: { children: ReactNode }) {
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioStreamManager, setAudioStreamManager] = useState<AudioStreamManager | null>(null);
  const [currentGameMode, setCurrentGameMode] = useState<GameMode | null>(null);
  const [gameTimer, setGameTimer] = useState<GameTimer | null>(null);
  
  const navigate = useNavigate();

  const isHost = !!playerId && 
                 !!roomData?.players && 
                 !!roomData.players[playerId]?.isHost;
  
  const playersList = roomData ? Object.entries(roomData.players || {}).map(([id, player]) => ({
    id,
    name: player.name,
    isHost: player.isHost,
    points: player.points || 0,
    team: player.team
  })) : [];
  
  const winnerName = roomData?.winnerInfo?.playerName || null;

  // Timer interval ref
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Modalità di gioco predefinite
  const gameModes: GameMode[] = [
    {
      type: 'classic',
      name: 'Classica',
      description: 'Modalità tradizionale senza limiti di tempo',
      settings: {
        pointsCorrect: 10,
        pointsWrong: 5
      }
    },
    {
      type: 'speed',
      name: 'Velocità',
      description: 'Rispondi entro il tempo limite!',
      settings: {
        timeLimit: 20,
        pointsCorrect: 15,
        pointsWrong: 5
      }
    },
    {
      type: 'marathon',
      name: 'Maratona',
      description: 'Playlist automatica senza pause',
      settings: {
        autoNext: true,
        pointsCorrect: 8,
        pointsWrong: 3
      }
    },
    {
      type: 'teams',
      name: 'Squadre',
      description: 'Gioca in team contro team!',
      settings: {
        teamsEnabled: true,
        pointsCorrect: 12,
        pointsWrong: 4
      }
    }
  ];

  // Gestione eventi automatici del buzz per le canzoni
  useEffect(() => {
    const handleEnableBuzzForSong = () => {
      if (isHost && roomCode) {
        enableBuzz();
      }
    };

    const handleDisableBuzzForSong = () => {
      if (isHost && roomCode) {
        disableBuzz();
      }
    };

    // Ascolta gli eventi dal player audio
    window.addEventListener('enableBuzzForSong', handleEnableBuzzForSong);
    window.addEventListener('disableBuzzForSong', handleDisableBuzzForSong);

    return () => {
      window.removeEventListener('enableBuzzForSong', handleEnableBuzzForSong);
      window.removeEventListener('disableBuzzForSong', handleDisableBuzzForSong);
    };
  }, [isHost, roomCode]);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    
    if (roomCode) {
      unsubscribe = listenToRoom(roomCode, (data) => {
        if (data) {
          setRoomData(data);
          
          if (playerId && data.players && !data.players[playerId]) {
            toast.error('Sei stato rimosso dalla stanza');
            setRoomCode(null);
            setRoomData(null);
            navigate('/');
          }
        } else {
          setError("La stanza non esiste più o è stata chiusa per inattività");
          setRoomCode(null);
          setRoomData(null);
          navigate('/');
        }
      });
    }
    
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [roomCode, navigate, playerId]);

  useEffect(() => {
    if (!roomCode || !playerId) return;
    
    // Aggiornamento iniziale solo una volta
    updateRoomActivity(roomCode).catch(err => {
      console.error("Error updating initial room activity:", err);
    });
    
    // Ridotto intervallo da 30 secondi a 2 minuti per ridurre carico database
    // Solo per l'host per evitare multiple scritture simultanee
    if (isHost) {
      const interval = setInterval(() => {
        if (roomCode) {
          updateRoomActivity(roomCode).catch(err => {
            console.error("Error updating room activity:", err);
          });
        }
      }, 120000); // 2 minuti invece di 30 secondi
      
      return () => clearInterval(interval);
    }
  }, [roomCode, playerId, isHost]);

  useEffect(() => {
    if (roomCode && isHost) {
      const manager = new AudioStreamManager(roomCode, true);
      manager.initialize().catch(console.error);
      setAudioStreamManager(manager);

      return () => {
        manager.stop();
        setAudioStreamManager(null);
      };
    }
  }, [roomCode, isHost]);

  const handleCreateRoom = async (name: string) => {
    try {
      setIsLoading(true);
      setError(null);
      
      let code = generateRoomCode();
      let roomExists = await checkRoomExists(code);
      
      while (roomExists) {
        code = generateRoomCode();
        roomExists = await checkRoomExists(code);
      }
      
      const generatedPlayerId = `${name.toLowerCase().replace(/\s/g, '_')}_${Date.now().toString().slice(-6)}`;
      await createRoom(code, name, generatedPlayerId);
      
      setPlayerName(name);
      setPlayerId(generatedPlayerId);
      setRoomCode(code);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      navigate(`/room/${code}`);
      toast.success(`Stanza ${code} creata con successo!`);
    } catch (err) {
      console.error('Errore nella creazione della stanza:', err);
      setError('Errore nella creazione della stanza. Riprova.');
      toast.error('Errore nella creazione della stanza');
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinRoom = async (code: string, name: string) => {
    try {
      setIsLoading(true);
      setError(null);
      
      const roomExists = await checkRoomExists(code);
      
      if (!roomExists) {
        setError('Stanza non trovata');
        toast.error('Stanza non trovata');
        return;
      }
      
      console.log(`Joining room ${code} with name ${name}`);
      const id = await joinRoom(code, name);
      console.log(`Received player ID: ${id}`);
      
      setPlayerName(name);
      setPlayerId(id);
      setRoomCode(code);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      navigate(`/room/${code}`);
      toast.success(`Sei entrato nella stanza ${code}`);
    } catch (err) {
      console.error('Errore nell\'entrare nella stanza:', err);
      setError('Errore nell\'entrare nella stanza. Riprova.');
      toast.error('Errore nell\'entrare nella stanza');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBuzz = useCallback(async (inputPlayerId?: string, inputPlayerName?: string) => {
    const buzzPlayerId = inputPlayerId || playerId;
    const buzzPlayerName = inputPlayerName || playerName;
    
    if (!roomCode || !roomData || !buzzPlayerId || !buzzPlayerName) return;

    // Verifica se il buzz è abilitato
    if (!roomData.buzzEnabled) {
      console.log('⚠️ Buzz disabilitato per questa stanza');
      return;
    }

    // Verifica se c'è già un vincitore
    if (roomData.winnerInfo) {
      console.log('⚠️ C\'è già un vincitore per questa domanda');
      return;
    }

    console.log('🚀 BUZZ fatto da:', buzzPlayerName);

    try {
      // Aggiorna lo stato della stanza con il vincitore
      await update(ref(database, `rooms/${roomCode}`), {
        winnerInfo: {
          playerId: buzzPlayerId,
          playerName: buzzPlayerName,
          timestamp: Date.now()
        },
        buzzEnabled: false // Disabilita ulteriori buzz
      });

      // Aggiungi evento per far riprendere la musica di background su tutti i dispositivi
      await update(ref(database, `rooms/${roomCode}/backgroundMusicControl`), {
        action: 'resume',
        timestamp: Date.now()
      });

      console.log('🚀 BUZZ: Evento mainPlayerPause inviato');
      window.dispatchEvent(new CustomEvent('mainPlayerPause'));

    } catch (error) {
      console.error('Errore durante l\'aggiornamento del buzz:', error);
      toast.error('Errore durante il buzz');
    }
  }, [roomCode, roomData, playerId, playerName]);

  const handleResetBuzz = async () => {
    if (!roomCode || !isHost) return;
    
    try {
      await resetBuzz(roomCode);
      await updateRoomActivity(roomCode);
      toast.success('Buzz resettato');
    } catch (err) {
      console.error('Errore nel resettare il buzz:', err);
      toast.error('Errore nel resettare il buzz');
    }
  };

  // Funzioni specifiche per assegnazione punti dal pannello di valutazione
  const awardCorrectAnswer = async () => {
    if (!roomCode || !isHost || !roomData?.winnerInfo) return;
    
    try {
      const winnerInfo = roomData.winnerInfo;
      const playerId = winnerInfo.playerId;
      const playerRef = ref(database, `rooms/${roomCode}/players/${playerId}`);
      const currentPlayer = roomData.players[playerId];
      
      if (!currentPlayer) return;
      
      // Punti base per risposta corretta
      const basePoints = currentGameMode?.settings?.pointsCorrect || 10;
      const currentScore = currentPlayer.points || 0;
      const currentStreak = (currentPlayer.currentStreak || 0) + 1;
      const bestStreak = Math.max(currentStreak, currentPlayer.bestStreak || 0);
      
      await update(playerRef, {
        points: currentScore + basePoints,
        currentStreak,
        bestStreak,
        correctAnswers: (currentPlayer.correctAnswers || 0) + 1,
        lastAnswerTime: Date.now()
      });
      
      await rejectPlayerAnswer(roomCode);
      
      // Disabilita il buzz dopo aver dato la risposta
      await disableBuzz();
      
      toast.success(`${currentPlayer.name}: +${basePoints} punti! (Risposta corretta)`);
      
    } catch (err) {
      console.error('Errore nell\'assegnare punti corretti:', err);
      toast.error('Errore nell\'assegnare punti');
    }
  };

  const awardWrongAnswer = async () => {
    if (!roomCode || !isHost || !roomData?.winnerInfo) return;
    
    try {
      const winnerInfo = roomData.winnerInfo;
      const playerId = winnerInfo.playerId;
      const playerRef = ref(database, `rooms/${roomCode}/players/${playerId}`);
      const currentPlayer = roomData.players[playerId];
      
      if (!currentPlayer) return;
      
      // Punti negativi per risposta sbagliata
      const penaltyPoints = currentGameMode?.settings?.pointsWrong || 5;
      const currentScore = currentPlayer.points || 0;
      const newScore = Math.max(0, currentScore - penaltyPoints);
      
      await update(playerRef, {
        points: newScore,
        currentStreak: 0, // Reset streak
        wrongAnswers: (currentPlayer.wrongAnswers || 0) + 1,
        lastAnswerTime: Date.now()
      });
      
      await rejectPlayerAnswer(roomCode);
      
      // Disabilita il buzz dopo aver dato la risposta
      await disableBuzz();
      
      toast.success(`${currentPlayer.name}: -${penaltyPoints} punti (Risposta sbagliata)`);
      
    } catch (err) {
      console.error('Errore nel sottrarre punti:', err);
      toast.error('Errore nel sottrarre punti');
    }
  };

  const awardSuperAnswer = async () => {
    if (!roomCode || !isHost || !roomData?.winnerInfo) return;
    
    try {
      const winnerInfo = roomData.winnerInfo;
      const playerId = winnerInfo.playerId;
      const playerRef = ref(database, `rooms/${roomCode}/players/${playerId}`);
      const currentPlayer = roomData.players[playerId];
      
      if (!currentPlayer) return;
      
      // Punti bonus per risposta eccellente
      const superPoints = 20;
      const currentScore = currentPlayer.points || 0;
      const currentStreak = (currentPlayer.currentStreak || 0) + 1;
      const bestStreak = Math.max(currentStreak, currentPlayer.bestStreak || 0);
      
      await update(playerRef, {
        points: currentScore + superPoints,
        currentStreak,
        bestStreak,
        correctAnswers: (currentPlayer.correctAnswers || 0) + 1,
        lastAnswerTime: Date.now()
      });
      
      await rejectPlayerAnswer(roomCode);
      
      // Disabilita il buzz dopo aver dato la risposta
      await disableBuzz();
      
      toast.success(`${currentPlayer.name}: +${superPoints} punti! (Risposta SUPER!)`);
      
    } catch (err) {
      console.error('Errore nell\'assegnare super punti:', err);
      toast.error('Errore nell\'assegnare punti');
    }
  };

  const awardPoints = async (amount: number = 10) => {
    if (!roomCode || !isHost || !roomData?.winnerInfo) return;
    
    try {
      const winnerInfo = roomData.winnerInfo;
      const responseTime = winnerInfo.timeLeft 
        ? (gameTimer?.totalTime || 30) - winnerInfo.timeLeft 
        : 3; // Default 3 secondi se non c'è timer
      
      // Usa il nuovo sistema di punteggio avanzato
      await updatePlayerScore(winnerInfo.playerId, true, responseTime);
      
      // Mantieni anche il sistema legacy per compatibilità
      await assignPoints(roomCode, winnerInfo.playerId, amount);
      
      // Disabilita il buzz dopo aver dato la risposta
      await disableBuzz();
      
    } catch (err) {
      console.error('Errore nell\'assegnare punti:', err);
      toast.error('Errore nell\'assegnare punti');
    }
  };

  const subtractPlayerPoints = async (amount: number = 5) => {
    if (!roomCode || !isHost || !roomData?.winnerInfo) return;
    
    try {
      const winnerInfo = roomData.winnerInfo;
      const responseTime = winnerInfo.timeLeft 
        ? (gameTimer?.totalTime || 30) - winnerInfo.timeLeft 
        : 3; // Default 3 secondi se non c'è timer
      
      // Usa il nuovo sistema di punteggio per risposta sbagliata
      await updatePlayerScore(winnerInfo.playerId, false, responseTime);
      
      // Mantieni anche il sistema legacy per compatibilità
      await subtractPoints(roomCode, winnerInfo.playerId, amount);
      
      // Disabilita il buzz dopo aver dato la risposta
      await disableBuzz();
      
    } catch (err) {
      console.error('Errore nel sottrarre punti:', err);
      toast.error('Errore nel sottrarre punti');
    }
  };

  const rejectAnswer = async () => {
    if (!roomCode || !isHost || !roomData?.winnerInfo) return;
    
    try {
      await rejectPlayerAnswer(roomCode);
      
      // Disabilita il buzz dopo aver rifiutato la risposta
      await disableBuzz();
      
    } catch (err) {
      console.error('Errore nel rifiutare la risposta:', err);
      toast.error('Errore nel rifiutare la risposta');
    }
  };

  const handleLeaveRoom = async () => {
    if (!roomCode || !playerId) return;
    
    try {
      await removePlayer(roomCode, playerId);
      await updateRoomActivity(roomCode);
      
      setRoomCode(null);
      setPlayerId(null);
      setRoomData(null);
      
      navigate('/');
      toast.success('Hai lasciato la stanza');
    } catch (err) {
      console.error('Errore nel lasciare la stanza:', err);
      toast.error('Errore nel lasciare la stanza');
    }
  };

  const submitAnswer = async (answer: string) => {
    if (!roomCode || !roomData?.winnerInfo) return;
    
    try {
      // Aggiorno il riferimento diretto alla stanza per aggiungere la risposta
      const winnerRef = ref(database, `rooms/${roomCode}`);
      
      // Imposto esplicitamente l'answer nel winnerInfo
      await update(winnerRef, {
        'winnerInfo/answer': answer,  // Percorso corretto alla proprietà answer
        lastActivity: Date.now()
      });
      
      console.log(`Risposta "${answer}" inviata con successo alla room ${roomCode}`);
      toast.success('Risposta inviata con successo');
    } catch (err) {
      console.error('Errore nell\'inviare la risposta:', err);
      toast.error('Errore nell\'inviare la risposta');
    }
  };

  // Funzione per impostare la modalità di gioco
  const setGameMode = async (mode: GameMode) => {
    if (!roomCode || !isHost) return;
    
    try {
      await update(ref(database, `rooms/${roomCode}`), {
        gameMode: mode,
        lastActivity: Date.now()
      });
      
      setCurrentGameMode(mode);
      toast.success(`Modalità "${mode.name}" attivata!`);
    } catch (err) {
      console.error('Errore nell\'impostare la modalità di gioco:', err);
      toast.error('Errore nell\'impostare la modalità di gioco');
    }
  };

  // Funzione per avviare il timer
  const startGameTimer = async (seconds: number) => {
    if (!roomCode || !isHost) return;
    
    try {
      const timer: GameTimer = {
        isActive: true,
        timeLeft: seconds,
        totalTime: seconds,
      };
      
      await update(ref(database, `rooms/${roomCode}`), {
        gameTimer: timer,
        lastActivity: Date.now()
      });
      
      setGameTimer(timer);
      toast.success(`Timer avviato: ${seconds} secondi!`);
    } catch (err) {
      console.error('Errore nell\'avviare il timer:', err);
      toast.error('Errore nell\'avviare il timer');
    }
  };

  // Funzione per fermare il timer
  const stopGameTimer = useCallback(async () => {
    if (!roomCode || !isHost) return;
    
    try {
      await update(ref(database, `rooms/${roomCode}`), {
        gameTimer: {
          isActive: false,
          timeLeft: 0,
          totalTime: 0
        }
      });
      toast.success('Timer fermato');
    } catch (error) {
      console.error('Errore nel fermare il timer:', error);
      toast.error('Errore nel fermare il timer');
    }
  }, [roomCode, isHost]);

  // Impostazioni di default per il punteggio
  const defaultScoreSettings: ScoreSettings = {
    basePoints: 100,
    speedBonus: 50,
    streakMultiplier: 1.5,
    maxSpeedBonus: 200,
    penaltyPoints: 25
  };

  // Funzione per calcolare il punteggio basato sulla velocità
  const calculateScore = (responseTime: number, isCorrect: boolean, streak: number = 0): number => {
    if (!isCorrect) return -defaultScoreSettings.penaltyPoints;
    
    let score = defaultScoreSettings.basePoints;
    
    // Bonus velocità (meno tempo = più punti)
    const speedBonus = Math.max(0, defaultScoreSettings.maxSpeedBonus - (responseTime * 10));
    score += Math.min(speedBonus, defaultScoreSettings.speedBonus);
    
    // Moltiplicatore streak
    if (streak > 0) {
      score *= Math.pow(defaultScoreSettings.streakMultiplier, Math.min(streak, 5));
    }
    
    return Math.round(score);
  };

  // Funzione per aggiornare il punteggio di un giocatore
  const updatePlayerScore = async (playerId: string, isCorrect: boolean, responseTime: number = 0) => {
    if (!roomCode || !roomData) return;
    
    try {
      const playerRef = ref(database, `rooms/${roomCode}/players/${playerId}`);
      const currentPlayer = roomData.players[playerId];
      
      if (!currentPlayer) return;
      
      const currentScore = currentPlayer.points || 0;
      const currentStreak = isCorrect ? (currentPlayer.currentStreak || 0) + 1 : 0;
      const bestStreak = Math.max(currentStreak, currentPlayer.bestStreak || 0);
      
      const scoreChange = calculateScore(responseTime, isCorrect, currentStreak);
      const newScore = Math.max(0, currentScore + scoreChange);
      
      await update(playerRef, {
        points: newScore,
        currentStreak,
        bestStreak,
        correctAnswers: (currentPlayer.correctAnswers || 0) + (isCorrect ? 1 : 0),
        wrongAnswers: (currentPlayer.wrongAnswers || 0) + (isCorrect ? 0 : 1),
        lastAnswerTime: Date.now()
      });
      
      // Salva nella cronologia locale senza Firebase push
      const historyEntry: ScoreHistory = {
        playerId,
        points: scoreChange,
        reason: isCorrect ? 'Risposta corretta' : 'Risposta sbagliata',
        timestamp: Date.now(),
        responseTime
      };
      
      toast.success(`${currentPlayer.name}: ${scoreChange > 0 ? '+' : ''}${scoreChange} punti!`);
      
    } catch (err) {
      console.error('Errore nell\'aggiornare il punteggio:', err);
      toast.error('Errore nell\'aggiornare il punteggio');
    }
  };

  // Effetto per gestire il timer lato client
  useEffect(() => {
    if (roomData?.gameTimer?.isActive) {
      const timer = roomData.gameTimer;
      
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      
      timerIntervalRef.current = setInterval(() => {
        setGameTimer(prev => {
          if (!prev) return null;
          const newTimeLeft = Math.max(0, prev.timeLeft - 0.1);
          
          if (newTimeLeft <= 0) {
            if (timerIntervalRef.current) {
              clearInterval(timerIntervalRef.current);
              timerIntervalRef.current = null;
            }
            
            if (isHost) {
              stopGameTimer().catch(error => {
                console.error('Errore nel fermare il timer automaticamente:', error);
              });
              toast.warning('Tempo scaduto!');
            }
          }
          
          return { ...prev, timeLeft: newTimeLeft };
        });
      }, 100);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
    
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [roomData?.gameTimer, isHost, stopGameTimer]);

  // Aggiorna il gameMode e gameTimer quando cambiano i roomData
  useEffect(() => {
    if (roomData?.gameMode) {
      setCurrentGameMode(roomData.gameMode);
    }
    if (roomData?.gameTimer) {
      setGameTimer(roomData.gameTimer);
    }
  }, [roomData?.gameMode, roomData?.gameTimer]);

  const enableBuzz = useCallback(async () => {
    if (!roomCode || !isHost) return;
    
    try {
      await update(ref(database, `rooms/${roomCode}`), {
        buzzEnabled: true,
        lastActivity: Date.now()
      });
      toast.success('Buzz attivato');
    } catch (err) {
      console.error('Errore nell\'attivare il buzz:', err);
      toast.error('Errore nell\'attivare il buzz');
    }
  }, [roomCode, isHost]);

  const disableBuzz = useCallback(async () => {
    if (!roomCode || !isHost) return;
    
    try {
      await update(ref(database, `rooms/${roomCode}`), {
        buzzEnabled: false,
        lastActivity: Date.now()
      });
      toast.success('Buzz disattivato');
    } catch (err) {
      console.error('Errore nel disattivare il buzz:', err);
      toast.error('Errore nel disattivare il buzz');
    }
  }, [roomCode, isHost]);

  const value = {
    roomCode,
    setRoomCode,
    playerName,
    setPlayerName,
    playerId,
    setPlayerId,
    roomData,
    isHost,
    isLoading,
    error,
    playersList,
    winnerName,
    handleCreateRoom,
    handleJoinRoom,
    handleBuzz,
    handleResetBuzz,
    handleLeaveRoom,
    awardPoints,
    subtractPlayerPoints,
    awardCorrectAnswer,
    awardWrongAnswer,
    awardSuperAnswer,
    rejectAnswer,
    submitAnswer,
    audioStreamManager,
    setAudioStreamManager,
    setGameMode,
    startGameTimer,
    stopGameTimer,
    currentGameMode,
    gameTimer,
    updatePlayerScore,
    calculateScore,
    enableBuzz,
    disableBuzz,
    isBuzzEnabled: !!roomData?.buzzEnabled,
  };

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export { RoomProvider };

// Hook per utilizzare il context
export const useRoom = (): RoomContextType => {
  const context = useContext(RoomContext);
  if (context === undefined) {
    throw new Error('useRoom deve essere usato all\'interno di un RoomProvider');
  }
  return context;
};