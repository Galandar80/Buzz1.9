import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRoom } from '../context/RoomContext';
import { Pause, Play, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import { AudioStreamManager } from '../services/webrtc';
import { addPlayedSong } from '../services/firebase';
import { toast } from 'sonner';

interface AudioPlayerProps {
  onAudioPause?: () => void;
}

// Componente CountdownOverlay integrato
const CountdownOverlay: React.FC<{ count: number; songName: string; isVisible: boolean }> = ({ 
  count, 
  songName, 
  isVisible 
}) => {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center">
      <div className="text-center space-y-8 animate-scale-in">
        <div className="space-y-4">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">
            🎵 Partenza tra...
          </h2>
        </div>
        
        <div className="relative">
          <div className={`
            text-8xl md:text-9xl font-bold text-white 
            animate-pulse-buzz shadow-text
            ${count <= 1 ? 'text-red-400' : count <= 2 ? 'text-yellow-400' : 'text-green-400'}
          `}>
            {count}
          </div>
          
          {/* Cerchio animato intorno al numero */}
          <div className={`
            absolute inset-0 rounded-full border-4 animate-ping
            ${count <= 1 ? 'border-red-400' : count <= 2 ? 'border-yellow-400' : 'border-green-400'}
          `} style={{ 
            width: '200px', 
            height: '200px',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)'
          }} />
        </div>
        
        <div className="space-y-2">
          <p className="text-white/60 text-sm">
            Preparatevi! La canzone inizierà tra pochissimo...
          </p>
          <div className="flex items-center justify-center gap-2 text-white/40 text-xs">
            <span>🎯</span>
            <span>Ascoltate attentamente e premete BUZZ quando sapete la risposta</span>
            <span>🎯</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const AudioPlayer: React.FC<AudioPlayerProps> = ({ onAudioPause }) => {
  const { isHost, roomData, roomCode } = useRoom();
  const [leftFiles, setLeftFiles] = useState<File[]>([]);
  const [rightFiles, setRightFiles] = useState<File[]>([]);
  const [masterVolume, setMasterVolume] = useState(1);
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
  const [currentColumn, setCurrentColumn] = useState<'left' | 'right' | null>(null);
  const [nowPlaying, setNowPlaying] = useState({ left: '', right: '' });
  const [loopMode, setLoopMode] = useState({ left: false, right: false });
  const [searchFilter, setSearchFilter] = useState({ left: '', right: '' });
  const [isMuted, setIsMuted] = useState(false);
  const [previousVolume, setPreviousVolume] = useState(1);
  const [isRemotePlaying, setIsRemotePlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  // Stati per il countdown
  const [isCountdownActive, setIsCountdownActive] = useState(false);
  const [countdownValue, setCountdownValue] = useState(3);
  const [pendingAudioData, setPendingAudioData] = useState<{
    file: File;
    column: 'left' | 'right';
  } | null>(null);

  const leftTbodyRef = useRef<HTMLTableSectionElement>(null);
  const rightTbodyRef = useRef<HTMLTableSectionElement>(null);
  const streamManagerRef = useRef<AudioStreamManager | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Gestione eventi globali del countdown per la sincronizzazione
  useEffect(() => {
    const handleCountdownStart = (e: CustomEvent) => {
      setIsCountdownActive(true);
      setCountdownValue(3);
      setPendingAudioData(e.detail);
    };

    const handleCountdownUpdate = (e: CustomEvent) => {
      setCountdownValue(e.detail.count);
    };

    const handleCountdownEnd = () => {
      setIsCountdownActive(false);
      setCountdownValue(3);
      setPendingAudioData(null);
    };

    window.addEventListener('countdownStart', handleCountdownStart as EventListener);
    window.addEventListener('countdownUpdate', handleCountdownUpdate as EventListener);
    window.addEventListener('countdownEnd', handleCountdownEnd);

    return () => {
      window.removeEventListener('countdownStart', handleCountdownStart as EventListener);
      window.removeEventListener('countdownUpdate', handleCountdownUpdate as EventListener);
      window.removeEventListener('countdownEnd', handleCountdownEnd);
    };
  }, []);

  // Inizializza WebRTC quando necessario
  useEffect(() => {
    if (roomCode && isHost) {
      streamManagerRef.current = new AudioStreamManager(roomCode, true);
      streamManagerRef.current.initialize().catch(console.error);

      return () => {
        streamManagerRef.current?.stop();
      };
    }
  }, [roomCode, isHost]);

  // Funzione per avviare il countdown
  const startCountdown = useCallback((file: File, column: 'left' | 'right') => {
    // Disabilita il buzz durante il countdown
    window.dispatchEvent(new CustomEvent('disableBuzzForSong'));
    
    // Invia evento globale per sincronizzare tutti i display
    window.dispatchEvent(new CustomEvent('countdownStart', {
      detail: { file, column, songName: file.name }
    }));

    setIsCountdownActive(true);
    setCountdownValue(3);
    setPendingAudioData({ file, column });

    let count = 3;
    
    countdownIntervalRef.current = setInterval(() => {
      count--;
      setCountdownValue(count);
      
      // Invia evento di aggiornamento per tutti i display
      window.dispatchEvent(new CustomEvent('countdownUpdate', {
        detail: { count, songName: file.name }
      }));

      if (count <= 0) {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
        
        // Countdown terminato, avvia l'audio
        setIsCountdownActive(false);
        setPendingAudioData(null);
        
        // Invia evento di fine countdown
        window.dispatchEvent(new CustomEvent('countdownEnd'));
        
        // Esegui l'audio effettivo
        executePlayAudio(file, column);
      }
    }, 1000);
  }, []);

  // Funzione separata per l'esecuzione effettiva dell'audio
  const executePlayAudio = useCallback((file: File, column: 'left' | 'right') => {
    if (currentAudio) {
      currentAudio.pause();
    }

    // Invia evento per far pausare la musica di background
    window.dispatchEvent(new CustomEvent('mainPlayerPlay'));

    const audio = new Audio(URL.createObjectURL(file));
    audio.volume = 0; // Inizia con volume 0 per il fade in
    
    // Cattura l'audio del sistema quando viene riprodotto
    if (isHost && streamManagerRef.current) {
      const audioContext = new AudioContext();
      const source = audioContext.createMediaElementSource(audio);
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      source.connect(audioContext.destination);

      // Invia lo stream audio attraverso WebRTC
      const stream = destination.stream;
      streamManagerRef.current.setAudioStream(stream);
    }
    
    audio.onended = () => {
      // Disabilita il buzz quando la canzone finisce
      window.dispatchEvent(new CustomEvent('disableBuzzForSong'));
      
      // Invia evento per far riprendere la musica di background
      window.dispatchEvent(new CustomEvent('mainPlayerPause'));
      
      if ((column === 'left' && loopMode.left) || (column === 'right' && loopMode.right)) {
        startCountdown(file, column); // Riavvia con countdown anche per il loop
      } else {
        setCurrentAudio(null);
        setNowPlaying(prev => ({ ...prev, [column]: '' }));
      }
    };

    // Fade in effect con callback per abilitare il buzz
    audio.play().then(() => {
      const fadeIn = setInterval(() => {
        if (audio && audio.volume < masterVolume) {
          audio.volume = Math.min(masterVolume, audio.volume + 0.1);
        } else {
          clearInterval(fadeIn);
          // Quando il fade in è completato, abilita il buzz
          window.dispatchEvent(new CustomEvent('enableBuzzForSong'));
        }
      }, 50);
    });

    setCurrentAudio(audio);
    setCurrentColumn(column);
    setNowPlaying(prev => ({ ...prev, [column]: file.name }));

    // Aggiungi il brano all'elenco dei brani già riprodotti in Firebase
    if (roomCode && isHost) {
      addPlayedSong(roomCode, file.name).catch(console.error);
    }

    // Mostra notifica di avvio
    toast.success(`🎵 Riproduzione iniziata: ${file.name}`, {
      duration: 3000,
    });
  }, [currentAudio, isHost, streamManagerRef, masterVolume, loopMode, roomCode, startCountdown]);

  // Funzione per fermare la riproduzione audio
  const stopAudioPlayback = useCallback(() => {
    // Ferma anche il countdown se attivo
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setIsCountdownActive(false);
    setPendingAudioData(null);
    window.dispatchEvent(new CustomEvent('countdownEnd'));

    // Disabilita il buzz quando si ferma manualmente l'audio
    window.dispatchEvent(new CustomEvent('disableBuzzForSong'));

    if (currentAudio) {
      // Fade out effect
      const fadeOut = setInterval(() => {
        if (currentAudio && currentAudio.volume > 0.1) {
          currentAudio.volume = Math.max(0, currentAudio.volume - 0.1);
        } else {
          if (currentAudio) {
            currentAudio.pause();
            currentAudio.volume = masterVolume;
            // Invia evento per far riprendere la musica di background
            window.dispatchEvent(new CustomEvent('mainPlayerPause'));
          }
          clearInterval(fadeOut);
        }
      }, 50);
    }
    setCurrentAudio(null);
    setNowPlaying({ left: '', right: '' });
    if (onAudioPause) onAudioPause();
  }, [currentAudio, masterVolume, onAudioPause]);

  // Esponi la funzione di pausa globalmente
  useEffect(() => {
    window.pauseAudioPlayer = stopAudioPlayback;

    return () => {
      delete window.pauseAudioPlayer;
    };
  }, [stopAudioPlayback]);

  // Ascolta i cambiamenti nel roomData per fermare l'audio quando qualcuno preme il buzz
  useEffect(() => {
    if (roomData?.winnerInfo) {
      if (currentAudio && !currentAudio.paused) {
        currentAudio.pause();
      }
    }
  }, [roomData?.winnerInfo, currentAudio]);

  // Gestione stato riproduzione audio remoto per utenti non host
  useEffect(() => {
    if (!isHost) {
      const remoteAudio = document.getElementById('remote-audio') as HTMLAudioElement | null;
      if (remoteAudio) {
        const handlePlay = () => setIsRemotePlaying(true);
        const handlePause = () => setIsRemotePlaying(false);
        remoteAudio.addEventListener('play', handlePlay);
        remoteAudio.addEventListener('pause', handlePause);
        return () => {
          remoteAudio.removeEventListener('play', handlePlay);
          remoteAudio.removeEventListener('pause', handlePause);
        };
      }
    }
  }, [isHost]);

  // Aggiorna il tempo corrente e la durata quando l'audio cambia
  useEffect(() => {
    if (currentAudio) {
      const updateTime = () => {
        setCurrentTime(currentAudio.currentTime);
      };
      const setAudioDuration = () => {
        setDuration(currentAudio.duration);
      };

      currentAudio.addEventListener('timeupdate', updateTime);
      currentAudio.addEventListener('loadedmetadata', setAudioDuration);

      return () => {
        currentAudio.removeEventListener('timeupdate', updateTime);
        currentAudio.removeEventListener('loadedmetadata', setAudioDuration);
      };
    }
  }, [currentAudio]);

  // Cleanup del countdown quando il componente viene smontato
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  const handleFileSelect = (column: 'left' | 'right') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mp3,.wav,.ogg';
    input.multiple = true;
    input.webkitdirectory = true;
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || [])
        .filter(file => /\.(mp3|wav|ogg)$/i.test(file.name));
      
      if (column === 'left') {
        setLeftFiles(files);
      } else {
        setRightFiles(files);
      }
      
      document.body.removeChild(input);
    });

    input.click();
  };

  // Modifica la funzione playAudio principale per usare il countdown
  const playAudio = useCallback((file: File, column: 'left' | 'right') => {
    // Solo l'host può avviare il countdown
    if (!isHost) return;
    
    // Se c'è già un countdown attivo, ignoralo
    if (isCountdownActive) {
      toast.info('Countdown già in corso...', { duration: 2000 });
      return;
    }

    // Avvia il countdown di 3 secondi
    startCountdown(file, column);
  }, [isHost, isCountdownActive, startCountdown]);

  const toggleLoop = (column: 'left' | 'right') => {
    setLoopMode(prev => ({ ...prev, [column]: !prev[column] }));
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseFloat(e.target.value);
    setMasterVolume(volume);
    if (currentAudio) {
      currentAudio.volume = volume;
    }
  };

  // Gestisce lo spostamento nella traccia audio (seeking)
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (currentAudio) {
      const seekTime = parseFloat(e.target.value);
      currentAudio.currentTime = seekTime;
      setCurrentTime(seekTime); // Aggiorno lo stato per feedback immediato UI
    }
  };

  // Funzione per formattare il tempo (MM:SS)
  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const togglePlayPause = () => {
    if (currentAudio) {
      if (currentAudio.paused) {
        currentAudio.play();
        // Invia evento per far pausare la musica di background
        window.dispatchEvent(new CustomEvent('mainPlayerPlay'));
      } else {
        currentAudio.pause();
        // Invia evento per far riprendere la musica di background
        window.dispatchEvent(new CustomEvent('mainPlayerPause'));
      }
    }
  };

  const toggleMute = () => {
    if (currentAudio) {
      if (isMuted) {
        currentAudio.volume = previousVolume;
        setMasterVolume(previousVolume);
      } else {
        setPreviousVolume(masterVolume);
        currentAudio.volume = 0;
        setMasterVolume(0);
      }
      setIsMuted(!isMuted);
    }
  };

  const isSongPlayed = (songName: string) => {
    return roomData?.playedSongs?.includes(songName) || false;
  };

  // Variabili filtrate per i file audio
  const filteredLeftFiles = leftFiles.filter(file => 
    file.name.toLowerCase().includes(searchFilter.left.toLowerCase())
  );
  
  const filteredRightFiles = rightFiles.filter(file => 
    file.name.toLowerCase().includes(searchFilter.right.toLowerCase())
  );

  // Funzione per resettare completamente il player audio (solo per l'host)
  const resetAudioPlayer = useCallback(() => {
    try {
      // Ferma il countdown se attivo
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      setIsCountdownActive(false);
      setPendingAudioData(null);
      window.dispatchEvent(new CustomEvent('countdownEnd'));

      // Ferma l'audio corrente
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.src = '';
        URL.revokeObjectURL(currentAudio.src);
      }

      // Reset di tutto lo stato
      setCurrentAudio(null);
      setCurrentColumn(null);
      setNowPlaying({ left: '', right: '' });
      setCurrentTime(0);
      setDuration(0);
      setMasterVolume(1);
      setIsMuted(false);
      setPreviousVolume(1);
      setLoopMode({ left: false, right: false });

      // Reset del WebRTC stream manager
      if (streamManagerRef.current) {
        streamManagerRef.current.stop();
        streamManagerRef.current = new AudioStreamManager(roomCode!, true);
        streamManagerRef.current.initialize().catch(console.error);
      }

      // Pulizia delle referenze audio
      if (window.pauseAudioPlayer) {
        delete window.pauseAudioPlayer;
      }
      window.pauseAudioPlayer = stopAudioPlayback;

      console.log('Player audio resettato completamente');
      toast.success('Player audio resettato con successo!', {
        description: 'Tutti gli stati audio sono stati ripristinati'
      });
    } catch (error) {
      console.error('Errore durante il reset del player audio:', error);
      toast.error('Errore durante il reset del player audio');
    }
  }, [currentAudio, roomCode, stopAudioPlayback]);

  return (
    <>
      {/* Countdown Overlay - Visibile su tutti i display */}
      <CountdownOverlay 
        count={countdownValue}
        songName={pendingAudioData?.file?.name || ''}
        isVisible={isCountdownActive}
      />

      {/* Il layout principale con le liste dei file e i controlli superiori per l'host */}
      {isHost && (
        <div className="w-full max-w-6xl mx-auto p-6 bg-white/10 backdrop-blur-md rounded-xl shadow-lg border border-white/20 mb-24"> {/* Aggiungo margine inferiore per non nascondere la barra fissa */}
          {/* Pulsante di reset del player audio - visibile solo per l'host */}
          <div className="mb-6 flex justify-between items-center">
            <h2 className="text-2xl font-bold text-primary">Audio Player - Controller</h2>
            <button
              onClick={resetAudioPlayer}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 rounded-lg transition-colors border border-red-500/30"
              title="Reset completo del player audio - Usa questo se il player non funziona più correttamente"
            >
              <RotateCcw className="w-5 h-5" />
              Reset Player Audio
            </button>
          </div>

          <div className="flex flex-col md:flex-row gap-6">
            {/* Player Sx */}
            <div className="flex-1">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-primary">Player Sx</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleFileSelect('left')}
                    className="px-4 py-2 bg-primary/20 hover:bg-primary/30 rounded-lg transition-colors"
                  >
                    Carica File
                  </button>
                  <button
                    onClick={() => toggleLoop('left')}
                    className={`px-4 py-2 rounded-lg transition-colors ${
                      loopMode.left ? 'bg-primary text-white' : 'bg-primary/20 hover:bg-primary/30'
                    }`}
                  >
                    Loop
                  </button>
                </div>
              </div>
              
              <input
                type="text"
                placeholder="Cerca brani..."
                value={searchFilter.left}
                onChange={(e) => setSearchFilter(prev => ({ ...prev, left: e.target.value }))}
                className="w-full p-2 mb-4 bg-white/10 rounded-lg border border-white/20"
              />

              <div className="bg-white/5 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-white/10">
                      <th className="p-2 text-left">#</th>
                      <th className="p-2 text-left">Titolo</th>
                      <th className="p-2 text-left">Play</th>
                    </tr>
                  </thead>
                  <tbody ref={leftTbodyRef}>
                    {filteredLeftFiles.map((file, index) => (
                      <tr 
                        key={index} 
                        onClick={() => playAudio(file, 'left')}
                        className={`cursor-pointer ${nowPlaying.left === file.name ? 'bg-primary/30' : isSongPlayed(file.name) ? 'bg-red-500/20' : ''}`}
                      >
                        <td className="w-10 text-center text-muted-foreground/60">{index + 1}</td>
                        <td className="track-title">{file.name}</td>
                        <td className="w-16 text-center">
                          <Play size={18} className="text-primary" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Player Dx */}
            <div className="flex-1">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-primary">Player Dx</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleFileSelect('right')}
                    className="px-4 py-2 bg-primary/20 hover:bg-primary/30 rounded-lg transition-colors"
                  >
                    Carica File
                  </button>
                  <button
                    onClick={() => toggleLoop('right')}
                    className={`px-4 py-2 rounded-lg transition-colors ${
                      loopMode.right ? 'bg-primary text-white' : 'bg-primary/20 hover:bg-primary/30'
                    }`}
                  >
                    Loop
                  </button>
                </div>
              </div>
              
              <input
                type="text"
                placeholder="Cerca brani..."
                value={searchFilter.right}
                onChange={(e) => setSearchFilter(prev => ({ ...prev, right: e.target.value }))}
                className="w-full p-2 mb-4 bg-white/10 rounded-lg border border-white/20"
              />

              <div className="bg-white/5 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-white/10">
                      <th className="p-2 text-left">#</th>
                      <th className="p-2 text-left">Titolo</th>
                      <th className="p-2 text-left">Play</th>
                    </tr>
                  </thead>
                  <tbody ref={rightTbodyRef}>
                    {filteredRightFiles.map((file, index) => (
                      <tr 
                        key={index} 
                        onClick={() => playAudio(file, 'right')}
                        className={`cursor-pointer ${nowPlaying.right === file.name ? 'bg-primary/30' : isSongPlayed(file.name) ? 'bg-red-500/20' : ''}`}
                      >
                        <td className="w-10 text-center text-muted-foreground/60">{index + 1}</td>
                        <td className="track-title">{file.name}</td>
                        <td className="w-16 text-center">
                          <Play size={18} className="text-primary" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Volume Control - Lo spostiamo nella barra fissa */}
          {/* <div className="mt-6 flex items-center gap-4">
            <span className="text-sm">Volume:</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={masterVolume}
              onChange={handleVolumeChange}
              className="flex-1"
            />
            <span className="text-sm">{Math.round(masterVolume * 100)}%</span>
          </div> */}
        </div>
      )}

      {/* Barra di controllo fissa per HOST e NON-HOST */}
      <div className="fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-md border-t border-white/20 p-4 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          {isHost ? (
            // Controlli per l'host (con seek bar e tempi)
            <div className="flex items-center gap-4 flex-1">
              <button
                onClick={togglePlayPause}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
                disabled={!currentAudio}
              >
                {currentAudio && !currentAudio.paused ? (
                  <Pause className="w-6 h-6 text-white" />
                ) : (
                  <Play className="w-6 h-6 text-white" />
                )}
              </button>

              <div className="flex-1 flex flex-col">
                <div className="text-sm text-white/80 mb-1">
                  {currentAudio ? (currentColumn === 'left' ? nowPlaying.left : nowPlaying.right) : 'Nessun brano in riproduzione'}
                </div>
                {currentAudio && ( // Barra di progresso interattiva per l'host
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white/60">{formatTime(currentTime)}</span>
                    <input
                      type="range"
                      min="0"
                      max={duration || 0}
                      value={currentTime}
                      onChange={handleSeek}
                      step="0.1"
                      className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer slider-thumb"
                    />
                    <span className="text-xs text-white/60">{formatTime(duration)}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            // Controlli per i giocatori non host (senza seek bar)
            <div className="flex items-center justify-center gap-4 flex-1">
              {isRemotePlaying ? (
                <div className="flex items-center gap-2 text-white">
                  <Play className="w-6 h-6 text-green-400 animate-pulse" />
                  <span>Audio in riproduzione dal padrone della stanza</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-white/60">
                  <Pause className="w-6 h-6" />
                  <span>Nessun audio in riproduzione</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-4">
            {isHost && (
              <button
                onClick={resetAudioPlayer}
                className="p-2 hover:bg-red-500/20 rounded-full transition-colors group"
                title="Reset completo del player audio"
              >
                <RotateCcw className="w-6 h-6 text-red-400 group-hover:text-red-300 transition-colors" />
              </button>
            )}

            <button
              onClick={toggleMute}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
              disabled={!currentAudio}
            >
              {isMuted ? (
                <VolumeX className="w-6 h-6 text-white" />
              ) : (
                <Volume2 className="w-6 h-6 text-white" />
              )}
            </button>

            <div className="flex items-center gap-2 w-32">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={masterVolume}
                onChange={handleVolumeChange}
                className="flex-1"
                disabled={!currentAudio}
              />
              <span className="text-sm text-white/80 w-12">
                {Math.round(masterVolume * 100)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Audio element per lo stream remoto (sempre presente per ricevere l'audio come non-host) */}
      <audio
        id="remote-audio"
        autoPlay
        playsInline
        className="hidden"
      />
    </>
  );
};

export default AudioPlayer; 