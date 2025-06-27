import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRoom } from '../context/RoomContext';
import { Pause, Play, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import { AudioStreamManager } from '../services/webrtc';
import { addPlayedSong } from '../services/firebase';
import { toast } from 'sonner';
import { ref, onValue, update } from 'firebase/database';
import { database } from '../services/firebase';

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
  
  // Stati per il countdown sincronizzato
  const [countdownValue, setCountdownValue] = useState(0);
  const [isCountdownActive, setIsCountdownActive] = useState(false);
  const [countdownSongName, setCountdownSongName] = useState('');
  const [pendingAudioData, setPendingAudioData] = useState<{ file: File; column: 'left' | 'right' } | null>(null);

  const leftTbodyRef = useRef<HTMLTableSectionElement>(null);
  const rightTbodyRef = useRef<HTMLTableSectionElement>(null);
  const streamManagerRef = useRef<AudioStreamManager | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Gestione eventi countdown e sincronizzazione con Firebase
  useEffect(() => {
    if (!roomCode) return;

    // TUTTI i dispositivi ascoltano i cambiamenti del countdown da Firebase
    const countdownRef = ref(database, `rooms/${roomCode}/countdown`);
    const unsubscribeCountdown = onValue(countdownRef, (snapshot) => {
      const countdownData = snapshot.val();
      if (countdownData) {
        console.log('🎵 Countdown ricevuto da Firebase:', countdownData);
        setIsCountdownActive(countdownData.isActive || false);
        setCountdownValue(countdownData.value || 0);
        setCountdownSongName(countdownData.songName || '');
        
        // Se il countdown è attivo, mostralo a tutti
        if (countdownData.isActive) {
          console.log('🎵 Countdown attivo per tutti i dispositivi:', {
            isActive: countdownData.isActive,
            value: countdownData.value,
            songName: countdownData.songName
          });
        }
      } else {
        setIsCountdownActive(false);
        setCountdownValue(0);
        setCountdownSongName('');
      }
    });

    // Solo l'host ascolta anche gli eventi per abilitare/disabilitare il buzz
    let unsubscribeBuzzControl = null;
    if (isHost) {
      unsubscribeBuzzControl = onValue(countdownRef, (snapshot) => {
        const countdownData = snapshot.val();
        if (countdownData) {
          if (countdownData.isActive && countdownData.value === 3) {
            // Inizio countdown - disabilita buzz
            window.dispatchEvent(new CustomEvent('disableBuzzForSong'));
          } else if (!countdownData.isActive && countdownData.value === 0) {
            // Fine countdown - abilita buzz quando inizia l'audio
            window.dispatchEvent(new CustomEvent('enableBuzzForSong'));
          }
        }
      });
    }

    return () => {
      unsubscribeCountdown();
      if (unsubscribeBuzzControl) {
        unsubscribeBuzzControl();
      }
    };
  }, [roomCode, isHost]);

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

  // Funzione separata per l'esecuzione dell'audio (senza countdown)
  const executePlayAudio = useCallback((file: File, column: 'left' | 'right') => {
    console.log('🎵 executePlayAudio chiamata per:', file.name);
    
    if (currentAudio) {
      console.log('🎵 Fermando audio corrente...');
      currentAudio.pause();
      // Pulisci URL object precedente
      if (currentAudio.src) {
        URL.revokeObjectURL(currentAudio.src);
      }
      setCurrentAudio(null);
    }

    const audioURL = URL.createObjectURL(file);
    const newAudio = new Audio(audioURL);
    newAudio.volume = masterVolume;
    newAudio.muted = isMuted;

    // Event listeners per sincronizzazione
    newAudio.addEventListener('play', () => {
      console.log('🎵 Audio effettivamente avviato - invio evento mainPlayerPlay');
      window.dispatchEvent(new CustomEvent('mainPlayerPlay'));
      window.dispatchEvent(new CustomEvent('enableBuzzForSong'));
      setIsRemotePlaying(true);
    });
    
    newAudio.addEventListener('pause', () => {
      console.log('🎵 Audio in pausa - invio evento mainPlayerPause');
      window.dispatchEvent(new CustomEvent('mainPlayerPause'));
      setIsRemotePlaying(false);
    });

    newAudio.addEventListener('ended', () => {
      console.log('🎵 Audio terminato - invio evento mainPlayerStop');
      window.dispatchEvent(new CustomEvent('mainPlayerStop'));
      window.dispatchEvent(new CustomEvent('disableBuzzForSong'));
      setIsRemotePlaying(false);
      
      // Pulisci URL object quando terminato
      URL.revokeObjectURL(audioURL);
      
      // Aggiungi la canzone ai brani riprodotti
      if (roomCode) {
        addPlayedSong(roomCode, file.name).catch(console.error);
      }
      
      if ((column === 'left' && loopMode.left) || (column === 'right' && loopMode.right)) {
        // Per il loop, riavvia direttamente senza countdown per evitare dipendenze circolari
        setTimeout(() => {
          executePlayAudio(file, column);
        }, 1000);
      } else {
        setCurrentAudio(null);
        setCurrentColumn(null);
        if (column === 'left') {
          setNowPlaying(prev => ({ ...prev, left: '' }));
        } else {
          setNowPlaying(prev => ({ ...prev, right: '' }));
        }
      }
    });

    newAudio.addEventListener('error', () => {
      console.error('🎵 Errore durante la riproduzione audio');
      URL.revokeObjectURL(audioURL);
      toast.error('Errore durante la riproduzione dell\'audio');
      setCurrentAudio(null);
      setCurrentColumn(null);
    });

    // Inizia il fade in del volume
    newAudio.volume = 0;
    console.log('🎵 Avviando riproduzione audio...');
    
    newAudio.play().then(() => {
      console.log('🎵 Audio play() riuscito - iniziando fade in');
      let currentVolume = 0;
      const fadeInterval = setInterval(() => {
        currentVolume += 0.05;
        if (currentVolume >= masterVolume) {
          currentVolume = masterVolume;
          clearInterval(fadeInterval);
          console.log('🎵 Fade in completato - volume finale:', currentVolume);
        }
        newAudio.volume = currentVolume;
      }, 50);
    }).catch(error => {
      console.error('🎵 Errore durante play():', error);
      URL.revokeObjectURL(audioURL);
      toast.error('Errore durante la riproduzione dell\'audio');
    });

    setCurrentAudio(newAudio);
    setCurrentColumn(column);
    
    if (column === 'left') {
      setNowPlaying(prev => ({ ...prev, left: file.name }));
    } else {
      setNowPlaying(prev => ({ ...prev, right: file.name }));
    }
  }, [currentAudio, masterVolume, isMuted, roomCode, loopMode]);

  // Funzione per avviare il countdown (solo per l'host)
  const startCountdown = useCallback(async (audioData: { file: File; column: 'left' | 'right' }) => {
    if (!isHost || !roomCode) return;

    console.log('🎵 Avvio countdown sincronizzato per:', audioData.file.name);
    
    try {
      // Disabilita il buzz durante il countdown
      window.dispatchEvent(new CustomEvent('disableBuzzForSong'));
      
      // Salva lo stato iniziale del countdown in Firebase
      await update(ref(database, `rooms/${roomCode}/countdown`), {
        isActive: true,
        value: 3,
        songName: audioData.file.name,
        startTime: Date.now()
      });

      setPendingAudioData(audioData);

      // Countdown da 3 a 0
      for (let i = 3; i > 0; i--) {
        console.log(`🎵 Countdown: ${i}`);
        await update(ref(database, `rooms/${roomCode}/countdown`), {
          value: i,
          isActive: true,
          songName: audioData.file.name
        });
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Fine countdown
      console.log('🎵 Countdown terminato - avvio musica');
      await update(ref(database, `rooms/${roomCode}/countdown`), {
        isActive: false,
        value: 0,
        songName: ''
      });

      // L'evento mainPlayerPlay sarà inviato automaticamente quando l'audio inizia effettivamente
      console.log('🎵 Esecuzione audio dopo countdown:', audioData.file.name);
      executePlayAudio(audioData.file, audioData.column);
      setPendingAudioData(null);

    } catch (error) {
      console.error('Errore durante il countdown:', error);
      // In caso di errore, pulisci lo stato
      await update(ref(database, `rooms/${roomCode}/countdown`), {
        isActive: false,
        value: 0,
        songName: ''
      });
      setPendingAudioData(null);
    }
  }, [isHost, roomCode, executePlayAudio]);

  const stopAudioPlayback = useCallback(() => {
    if (currentAudio) {
      // Fade out prima di fermare
      let currentVolume = currentAudio.volume;
      const fadeInterval = setInterval(() => {
        currentVolume -= 0.1;
        if (currentVolume <= 0) {
          currentVolume = 0;
          currentAudio.volume = 0;
          currentAudio.pause();
          // Pulisci URL object quando fermiamo l'audio
          if (currentAudio.src) {
            URL.revokeObjectURL(currentAudio.src);
          }
          clearInterval(fadeInterval);
        } else {
          currentAudio.volume = currentVolume;
        }
      }, 50);
    }

    // Reset degli stati
    setCurrentAudio(null);
    setCurrentColumn(null);
    setNowPlaying({ left: '', right: '' });
    setIsCountdownActive(false);
    setPendingAudioData(null);

    // Disabilita il buzz quando si ferma manualmente l'audio
    window.dispatchEvent(new CustomEvent('disableBuzzForSong'));
    window.dispatchEvent(new CustomEvent('mainPlayerStop'));
    setIsRemotePlaying(false);
  }, [currentAudio]);

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

  // 🔥 LISTENER FIREBASE PER COUNTDOWN - Sincronizza su tutti i dispositivi
  useEffect(() => {
    if (!roomCode) return;

    const countdownRef = ref(database, `rooms/${roomCode}/countdown`);
    
    const unsubscribe = onValue(countdownRef, (snapshot) => {
      const countdownData = snapshot.val();
      
      if (countdownData) {
        console.log('📱 Countdown ricevuto da Firebase:', countdownData);
        
        // Aggiorna lo stato del countdown per tutti i dispositivi
        setIsCountdownActive(countdownData.isActive || false);
        setCountdownValue(countdownData.value || 0);
        setCountdownSongName(countdownData.songName || '');
        
        // Se il countdown è attivo e non siamo l'host, gestiamo gli eventi buzz
        if (countdownData.isActive) {
          window.dispatchEvent(new CustomEvent('disableBuzzForSong'));
        } else if (countdownData.value === 0 && !countdownData.isActive) {
          // Il countdown è finito, abilita il buzz
          window.dispatchEvent(new CustomEvent('enableBuzzForSong'));
        }
      }
    });

    return () => unsubscribe();
  }, [roomCode]);

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
    startCountdown({ file, column });
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
        songName={countdownSongName}
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