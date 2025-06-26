import React, { useEffect, useState } from 'react';
import { useRoom } from '../context/RoomContext';
import { toast } from 'sonner';
import { MessageCircle, Send, Clock } from 'lucide-react';

export function AnswerNotification() {
  const { roomData } = useRoom();
  const [lastAnswerTimestamp, setLastAnswerTimestamp] = useState<number | null>(null);

  useEffect(() => {
    const winnerInfo = roomData?.winnerInfo;
    
    if (winnerInfo?.answer && winnerInfo.timestamp !== lastAnswerTimestamp) {
      // Nuova risposta ricevuta
      setLastAnswerTimestamp(winnerInfo.timestamp);
      
      // Mostra notifica toast per tutti
      toast.success(
        `${winnerInfo.playerName} ha inviato una risposta!`,
        {
          icon: <MessageCircle className="h-4 w-4" />,
          duration: 4000,
          description: "Clicca per visualizzare la risposta",
        }
      );

      // Vibrazione per dispositivi mobili
      if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate([100, 50, 100]);
      }

      // Suono di notifica (opzionale)
      try {
        const audio = new Audio('/notification.mp3');
        audio.volume = 0.3;
        audio.play().catch(() => {
          // Ignora errori audio se non supportato
        });
      } catch {
        // Ignora errori audio
      }
    }
  }, [roomData?.winnerInfo, lastAnswerTimestamp]);

  // Questo componente non renderizza nulla visivamente
  return null;
}

export default AnswerNotification; 