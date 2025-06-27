import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRoom } from '../context/RoomContext';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Volume2, VolumeX, Music, Upload, Play, Pause, SkipForward } from 'lucide-react';
import { toast } from 'sonner';
import { ref, onValue } from 'firebase/database';
import { database } from '../services/firebase';

interface BackgroundMusicProps {
  volume?: number;
  autoPlay?: boolean;
}

const BackgroundMusic: React.FC<BackgroundMusicProps> = ({ 
  volume = 0.3, 
  autoPlay = true 
}) => {
  const { isHost, roomCode } = useRoom();
  const [backgroundTracks, setBackgroundTracks] = useState<File[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [backgroundVolume, setBackgroundVolume] = useState(volume);
  const [isMuted, setIsMuted] = useState(false);
  const [previousVolume, setPreviousVolume] = useState(volume);
  const [savedCurrentTime, setSavedCurrentTime] = useState(0);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentFadeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Funzioni per il fade in/out
  const fadeOutBackground = useCallback(() => {
    console.log('🎵 Fade out background music iniziato');
    
    // Pulisci eventuali fade in corso
    if (currentFadeIntervalRef.current) {
      clearInterval(currentFadeIntervalRef.current);
      currentFadeIntervalRef.current = null;
    }
    
    if (audioRef.current && (audioRef.current.paused === false || audioRef.current.currentTime > 0)) {
      currentFadeIntervalRef.current = setInterval(() => {
        if (audioRef.current) {
          audioRef.current.volume = Math.max(0, audioRef.current.volume - 0.1);
          
          if (audioRef.current.volume <= 0) {
            if (currentFadeIntervalRef.current) {
              clearInterval(currentFadeIntervalRef.current);
              currentFadeIntervalRef.current = null;
            }
            audioRef.current.pause();
            console.log('🎵 Background music messa in pausa dopo fade out');
          }
        } else {
          if (currentFadeIntervalRef.current) {
            clearInterval(currentFadeIntervalRef.current);
            currentFadeIntervalRef.current = null;
          }
        }
      }, 50);
    }
  }, []);

  const fadeInBackground = useCallback(() => {
    console.log('🎵 Fade in background music iniziato');
    
    // Pulisci eventuali fade in corso
    if (currentFadeIntervalRef.current) {
      clearInterval(currentFadeIntervalRef.current);
      currentFadeIntervalRef.current = null;
    }
    
    if (audioRef.current) {
      // Se l'audio è in pausa, riprendi dalla posizione salvata
      if (audioRef.current.paused) {
        audioRef.current.play().then(() => {
          console.log('🎵 Background music ripresa dopo pausa');
        }).catch(error => {
          console.error('🎵 Errore durante la ripresa della background music:', error);
        });
      }
      
      currentFadeIntervalRef.current = setInterval(() => {
        if (audioRef.current) {
          audioRef.current.volume = Math.min(backgroundVolume, audioRef.current.volume + 0.05);
          
          if (audioRef.current.volume >= backgroundVolume) {
            if (currentFadeIntervalRef.current) {
              clearInterval(currentFadeIntervalRef.current);
              currentFadeIntervalRef.current = null;
            }
            console.log('🎵 Fade in background music completato');
          }
        } else {
          if (currentFadeIntervalRef.current) {
            clearInterval(currentFadeIntervalRef.current);
            currentFadeIntervalRef.current = null;
          }
        }
      }, 100);
    }
  }, [backgroundVolume]);

  // Event listeners per sincronizzazione con il player principale
  useEffect(() => {
    console.log('🎵 Inizializzazione event listeners BackgroundMusic');
    
    const handleMainPlayerPlay = () => {
      console.log('🎵 BackgroundMusic: ricevuto evento mainPlayerPlay');
      fadeOutBackground();
    };
    
    const handleMainPlayerPause = () => {
      console.log('🎵 BackgroundMusic: ricevuto evento mainPlayerPause');
      // Aspetta un po' prima di riavviare per dare tempo al player principale
      setTimeout(() => {
        fadeInBackground();
      }, 500);
    };
    
    const handleMainPlayerStop = () => {
      console.log('🎵 BackgroundMusic: ricevuto evento mainPlayerStop');
      // Aspetta un po' prima di riavviare per dare tempo al player principale
      setTimeout(() => {
        fadeInBackground();
      }, 500);
    };

    // Aggiungi event listeners
    window.addEventListener('mainPlayerPlay', handleMainPlayerPlay);
    window.addEventListener('mainPlayerPause', handleMainPlayerPause);
    window.addEventListener('mainPlayerStop', handleMainPlayerStop);

    // Cleanup
    return () => {
      console.log('🎵 Pulizia event listeners BackgroundMusic');
      window.removeEventListener('mainPlayerPlay', handleMainPlayerPlay);
      window.removeEventListener('mainPlayerPause', handleMainPlayerPause);
      window.removeEventListener('mainPlayerStop', handleMainPlayerStop);
    };
  }, [fadeOutBackground, fadeInBackground]);

  // Monitora i cambiamenti del player principale e del controllo da Firebase
  useEffect(() => {
    console.log('🎵 BackgroundMusic: Inizializzando event listeners...');
    
    // Ascolta anche i controlli da Firebase per sincronizzazione tra dispositivi
    let unsubscribeControl = null;
    if (roomCode) {
      const backgroundMusicControlRef = ref(database, `rooms/${roomCode}/backgroundMusicControl`);
      unsubscribeControl = onValue(backgroundMusicControlRef, (snapshot) => {
        const controlData = snapshot.val();
        if (controlData && controlData.action === 'resume') {
          console.log('🎵 BackgroundMusic: ricevuto comando resume da Firebase');
          setTimeout(() => {
            fadeInBackground();
          }, 1000);
        }
      });
    }

    return () => {
      console.log('🎵 BackgroundMusic: Rimuovendo event listeners...');
      if (unsubscribeControl) {
        unsubscribeControl();
      }
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
      }
    };
  }, [fadeOutBackground, fadeInBackground, roomCode]);

  // Effetto separato per aggiornare le funzioni quando cambiano le dipendenze
  useEffect(() => {
    // Aggiorna le funzioni quando cambiano gli stati
    console.log('🎵 BackgroundMusic: Stati aggiornati - isPlaying:', isPlaying, 'isPaused:', isPaused);
  }, [isPlaying, isPaused, backgroundTracks.length, roomCode]);

  // Inizializza l'audio quando ci sono tracce disponibili
  useEffect(() => {
    if (backgroundTracks.length > 0 && !audioRef.current) {
      const audio = new Audio(URL.createObjectURL(backgroundTracks[currentTrackIndex]));
      audio.volume = backgroundVolume;
      audio.loop = false;
      
      audio.onended = () => {
        nextTrack();
      };
      
      audio.onerror = () => {
        console.error('Errore nella riproduzione della musica di background');
        nextTrack();
      };
      
      audioRef.current = audio;
      
      if (autoPlay) {
        audio.play().then(() => {
          setIsPlaying(true);
          toast.success('Musica di background avviata');
        }).catch(console.error);
      }
    }
  }, [backgroundTracks, currentTrackIndex, backgroundVolume, autoPlay]);

  // Pulisce l'audio quando il componente viene smontato
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
      }
      if (currentFadeIntervalRef.current) {
        clearInterval(currentFadeIntervalRef.current);
        currentFadeIntervalRef.current = null;
      }
    };
  }, []);

  const handleFileSelect = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mp3,.wav,.ogg';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || [])
        .filter(file => /\.(mp3|wav|ogg)$/i.test(file.name));
      
      setBackgroundTracks(files);
      setCurrentTrackIndex(0);
      
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
        audioRef.current = null;
      }
      
      document.body.removeChild(input);
      toast.success(`${files.length} tracce caricate per la musica di background`);
    });

    input.click();
  };

  const nextTrack = () => {
    if (backgroundTracks.length === 0) return;
    
    const nextIndex = (currentTrackIndex + 1) % backgroundTracks.length;
    setCurrentTrackIndex(nextIndex);
    
    // 🎵 RESET DELLA POSIZIONE SALVATA QUANDO SI CAMBIA TRACCIA
    setSavedCurrentTime(0);
    console.log('🎵 Cambio traccia - reset posizione salvata');
    
    if (audioRef.current) {
      audioRef.current.pause();
      URL.revokeObjectURL(audioRef.current.src);
      audioRef.current = null;
    }
  };

  const togglePlayPause = () => {
    if (!audioRef.current || backgroundTracks.length === 0) return;
    
    if (isPlaying && !isPaused) {
      // 🎵 SALVA LA POSIZIONE QUANDO L'UTENTE METTE IN PAUSA MANUALMENTE
      const currentTime = audioRef.current.currentTime;
      setSavedCurrentTime(currentTime);
      console.log('🎵 Pausa manuale - posizione salvata:', currentTime, 'secondi');
      
      audioRef.current.pause();
      setIsPlaying(false);
      setIsPaused(true);
    } else {
      // 🎵 RIPRISTINA LA POSIZIONE QUANDO L'UTENTE RIPRENDE MANUALMENTE
      if (savedCurrentTime > 0) {
        console.log('🎵 Ripresa manuale - ripristino posizione:', savedCurrentTime, 'secondi');
        audioRef.current.currentTime = savedCurrentTime;
      }
      
      audioRef.current.play().then(() => {
        setIsPlaying(true);
        setIsPaused(false);
      }).catch(console.error);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setBackgroundVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    
    if (isMuted) {
      audioRef.current.volume = previousVolume;
      setBackgroundVolume(previousVolume);
    } else {
      setPreviousVolume(backgroundVolume);
      audioRef.current.volume = 0;
      setBackgroundVolume(0);
    }
    setIsMuted(!isMuted);
  };

  const getCurrentTrackName = () => {
    if (backgroundTracks.length === 0) return 'Nessuna traccia';
    return backgroundTracks[currentTrackIndex]?.name || 'Traccia sconosciuta';
  };

  // Funzione di debug per controllare lo stato dell'audio
  const debugAudioState = useCallback(() => {
    if (audioRef.current) {
      console.log('=== DEBUG AUDIO STATE ===');
      console.log('Audio paused:', audioRef.current.paused);
      console.log('Audio volume:', audioRef.current.volume);
      console.log('Target volume (backgroundVolume):', backgroundVolume);
      console.log('Is playing:', isPlaying);
      console.log('Is paused:', isPaused);
      console.log('Is muted:', isMuted);
      console.log('=========================');
    }
  }, [backgroundVolume, isPlaying, isPaused, isMuted]);

  // Verifica periodica del volume per assicurarsi che sia corretto
  useEffect(() => {
    const checkVolumeInterval = setInterval(() => {
      if (audioRef.current && isPlaying && !isPaused && !isMuted) {
        // Se l'audio è in riproduzione ma il volume è troppo basso, ripristinalo
        if (audioRef.current.volume < backgroundVolume * 0.8) {
          console.log('Volume check: volume too low', audioRef.current.volume, 'expected:', backgroundVolume);
          audioRef.current.volume = backgroundVolume;
        }
      }
    }, 2000); // Controlla ogni 2 secondi

    return () => {
      clearInterval(checkVolumeInterval);
    };
  }, [isPlaying, isPaused, isMuted, backgroundVolume]);

  // Mostra il componente solo per l'host
  if (!isHost) return null;

  return (
    <Card className="w-full max-w-4xl mx-auto p-4 bg-gradient-to-r from-purple-500/10 to-blue-500/10 backdrop-blur-md border border-purple-300/30 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <Music className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Musica di Background</h3>
            <p className="text-sm text-purple-200">
              Si pausa automaticamente durante la riproduzione delle canzoni del gioco
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            onClick={handleFileSelect}
            variant="outline"
            size="sm"
            className="bg-purple-500/20 border-purple-400/30 text-purple-200 hover:bg-purple-500/30"
          >
            <Upload className="w-4 h-4 mr-2" />
            Carica Musica
          </Button>
          
          {/* Pulsante di debug temporaneo */}
          <Button
            onClick={() => {
              debugAudioState();
              if (audioRef.current && backgroundTracks.length > 0) {
                console.log('Force setting volume to:', backgroundVolume);
                audioRef.current.volume = backgroundVolume;
                if (audioRef.current.paused && !isMuted) {
                  audioRef.current.play().catch(console.error);
                  setIsPlaying(true);
                  setIsPaused(false);
                }
              }
            }}
            variant="outline"
            size="sm"
            className="bg-red-500/20 border-red-400/30 text-red-200 hover:bg-red-500/30"
          >
            🔧 Debug
          </Button>
        </div>
      </div>

      {backgroundTracks.length > 0 && (
        <div className="space-y-4">
          {/* Informazioni traccia corrente */}
          <div className="bg-white/5 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">In riproduzione:</p>
                <p className="font-medium text-white truncate">{getCurrentTrackName()}</p>
                <p className="text-xs text-gray-500">
                  Traccia {currentTrackIndex + 1} di {backgroundTracks.length}
                </p>
              </div>
              
              <div className="flex items-center gap-2">
                <Button
                  onClick={togglePlayPause}
                  variant="outline"
                  size="sm"
                  className="bg-green-500/20 border-green-400/30 text-green-200 hover:bg-green-500/30"
                >
                  {isPlaying && !isPaused ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                </Button>
                
                <Button
                  onClick={nextTrack}
                  variant="outline"
                  size="sm"
                  className="bg-blue-500/20 border-blue-400/30 text-blue-200 hover:bg-blue-500/30"
                >
                  <SkipForward className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Controlli volume */}
          <div className="flex items-center gap-4">
            <button
              onClick={toggleMute}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            >
              {isMuted ? (
                <VolumeX className="w-5 h-5 text-gray-400" />
              ) : (
                <Volume2 className="w-5 h-5 text-white" />
              )}
            </button>
            
            <div className="flex-1">
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={backgroundVolume}
                onChange={handleVolumeChange}
                className="w-full background-music-slider"
                style={{ '--value': `${backgroundVolume * 100}%` } as React.CSSProperties}
              />
            </div>
            
            <span className="text-sm text-gray-400 min-w-[3rem]">
              {Math.round(backgroundVolume * 100)}%
            </span>
          </div>

          {/* Indicatore stato */}
          <div className="flex items-center gap-2 text-xs">
            <div className={`w-2 h-2 rounded-full bg-music-status-indicator ${
              isPlaying && !isPaused ? 'bg-music-playing' : 
              isPaused ? 'bg-music-paused' : 'bg-music-stopped'
            }`} />
            <span className="text-gray-400">
              {isPlaying && !isPaused ? 'In riproduzione' : 
               isPaused ? 'In pausa (gioco attivo)' : 'Fermata'}
            </span>
          </div>
        </div>
      )}

      {backgroundTracks.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <Music className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="mb-2">Nessuna musica di background caricata</p>
          <p className="text-sm">Carica dei file audio per la musica ambientale</p>
        </div>
      )}
    </Card>
  );
};

export default BackgroundMusic; 