import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, off, push, child, get, update, runTransaction } from "firebase/database";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";

// Importo il tipo RoomData
interface Player {
  name: string;
  isHost: boolean;
  joinedAt: number;
  points?: number;
}

interface WinnerInfo {
  playerId: string;
  playerName: string;
  timestamp: number;
  answer?: string;
}

interface RoomData {
  hostName: string;
  createdAt: number;
  winnerInfo: WinnerInfo | null;
  players: Record<string, Player>;
  playedSongs?: string[];
}

const firebaseConfig = {
  apiKey: "AIzaSyD3bpQxIsgbmxkqbd_EOPOhu7_5jZWnFPc",
  authDomain: "indovinalacanzone-e9be8.firebaseapp.com",
  databaseURL: "https://indovinalacanzone-e9be8-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "indovinalacanzone-e9be8",
  storageBucket: "indovinalacanzone-e9be8.firebasestorage.app",
  messagingSenderId: "228445399207",
  appId: "1:228445399207:web:5e76b44033bc7dd7289382",
  measurementId: "G-Z8DNXN1G6X"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const analytics = getAnalytics(app);
const auth = getAuth(app);

// Aumenta il timeout di inattività da 240 minuti a 24 ore (1440 minuti)
// per evitare disconnessioni premature durante il gioco
const ROOM_INACTIVITY_TIMEOUT = 1440 * 60 * 1000; // 24 ore in millisecondi

export const generateRoomCode = (): string => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

export const checkRoomExists = async (roomCode: string): Promise<boolean> => {
  const roomRef = ref(database, `rooms/${roomCode}`);
  const snapshot = await get(roomRef);
  return snapshot.exists();
};

export const createRoom = async (roomCode: string, hostName: string, hostId: string): Promise<void> => {
  const roomRef = ref(database, `rooms/${roomCode}`);
  const room = {
    hostName,
    hostId,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    winnerInfo: null,
    buzzEnabled: false, // Il buzz inizia disabilitato e si attiva con le canzoni
    players: {
      [hostId]: {
        name: hostName,
        isHost: true,
        joinedAt: Date.now(),
        points: 0
      }
    }
  };
  
  await set(roomRef, room);
};

const checkExistingPlayer = async (roomCode: string, playerName: string): Promise<{exists: boolean, playerId?: string, points?: number, isHost?: boolean}> => {
  const roomRef = ref(database, `rooms/${roomCode}/players`);
  const snapshot = await get(roomRef);
  
  if (snapshot.exists()) {
    const players = snapshot.val();
    const normalizedSearchName = playerName.toLowerCase().trim();
    
    for (const id in players) {
      const playerNormalizedName = players[id].name.toLowerCase().trim();
      if (playerNormalizedName === normalizedSearchName) {
        console.log(`Player ${playerName} found with ID ${id} and points ${players[id].points || 0}`);
        return {
          exists: true,
          playerId: id,
          points: players[id].points || 0,
          isHost: players[id].isHost || false
        };
      }
    }
  }
  
  console.log(`No existing player found with name ${playerName}`);
  return { exists: false };
};

export const joinRoom = async (roomCode: string, playerName: string): Promise<string> => {
  try {
    // Prima verifichiamo che la stanza esista e sia attiva
    const roomRef = ref(database, `rooms/${roomCode}`);
    const roomSnapshot = await get(roomRef);
    
    if (!roomSnapshot.exists()) {
      throw new Error('Stanza non trovata');
    }
    
    const roomData = roomSnapshot.val();
    
    // Aggiorna immediatamente l'attività della stanza per evitare che venga marcata come inattiva
    await updateRoomActivity(roomCode);
    
    // Controlla l'inattività solo se è davvero molto antica (più di 24 ore)
    if (isRoomInactive(roomData.lastActivity || roomData.createdAt)) {
      throw new Error('La stanza è scaduta per inattività');
    }

    const existingPlayer = await checkExistingPlayer(roomCode, playerName);
    
    if (existingPlayer.exists && existingPlayer.playerId) {
      console.log(`Reusing existing player ID: ${existingPlayer.playerId} with points: ${existingPlayer.points}`);
      
      const playerRef = ref(database, `rooms/${roomCode}/players/${existingPlayer.playerId}`);
      
      const currentSnapshot = await get(playerRef);
      if (currentSnapshot.exists()) {
        const currentData = currentSnapshot.val();
        
        await update(playerRef, {
          name: playerName,
          joinedAt: Date.now(),
          points: currentData.points || existingPlayer.points || 0,
          isHost: currentData.isHost || existingPlayer.isHost || false
        });
        
        console.log(`Player data updated. Current points: ${currentData.points} and isHost: ${currentData.isHost}`);
      } else {
        await set(playerRef, {
          name: playerName,
          isHost: existingPlayer.isHost || false,
          joinedAt: Date.now(),
          points: existingPlayer.points || 0
        });
      }
      
      // Aggiorna nuovamente l'attività dopo il join
      await updateRoomActivity(roomCode);
      
      return existingPlayer.playerId;
    } else {
      const playerId = generatePlayerId(playerName);
      const playerRef = ref(database, `rooms/${roomCode}/players/${playerId}`);
      
      console.log(`Creating new player with ID: ${playerId}`);
      
      await set(playerRef, {
        name: playerName,
        isHost: false,
        joinedAt: Date.now(),
        points: 0
      });
      
      // Aggiorna l'attività dopo il join del nuovo giocatore
      await updateRoomActivity(roomCode);
      
      return playerId;
    }
  } catch (error) {
    console.error('Error in joinRoom:', error);
    throw error;
  }
};

export const generatePlayerId = (name: string): string => {
  return `${name.toLowerCase().replace(/\s/g, '_')}_${Date.now().toString().slice(-6)}`;
};

export const updateRoomActivity = async (roomCode: string): Promise<void> => {
  const roomRef = ref(database, `rooms/${roomCode}`);
  await update(roomRef, {
    lastActivity: Date.now()
  });
};

const isRoomInactive = (lastActivity: number): boolean => {
  const now = Date.now();
  const inactive = now - lastActivity > ROOM_INACTIVITY_TIMEOUT;
  return inactive;
};

export const deleteRoom = async (roomCode: string): Promise<void> => {
  console.log(`Deleting room ${roomCode}`);
  const roomRef = ref(database, `rooms/${roomCode}`);
  await set(roomRef, null);
};

export const listenToRoom = (
  roomCode: string, 
  callback: (data: RoomData | null) => void
): (() => void) => {
  const roomRef = ref(database, `rooms/${roomCode}`);
  
  const unsubscribe = onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    
    if (data) {
      const lastActivity = data.lastActivity || data.createdAt;
      const hasActivePlayers = data.players && Object.keys(data.players).length > 0;
      
      if (!hasActivePlayers && isRoomInactive(lastActivity)) {
        deleteRoom(roomCode).then(() => {
          callback(null);
        }).catch(err => {
          console.error(`Error deleting room ${roomCode}:`, err);
        });
      } else {
        callback(data);
      }
    } else {
      callback(null);
    }
  }, (error) => {
    console.error(`Error in room listener for ${roomCode}:`, error);
  });
  
  return () => {
    off(roomRef);
  };
};

export const registerBuzz = async (roomCode: string, playerId: string, playerName: string): Promise<void> => {
  const winnerRef = ref(database, `rooms/${roomCode}/winnerInfo`);
  const winnerSnapshot = await get(winnerRef);
  
  if (!winnerSnapshot.exists()) {
    await update(ref(database, `rooms/${roomCode}`), {
      winnerInfo: {
        playerId,
        playerName,
        timestamp: Date.now()
      },
      lastActivity: Date.now()
    });
  }
};

export const resetBuzz = async (roomCode: string): Promise<void> => {
  const winnerRef = ref(database, `rooms/${roomCode}/winnerInfo`);
  await set(winnerRef, null);
};

export const removePlayer = async (roomCode: string, playerId: string): Promise<void> => {
  const playerRef = ref(database, `rooms/${roomCode}/players/${playerId}`);
  await set(playerRef, null);
};

export const assignPoints = async (roomCode: string, playerId: string, points: number): Promise<void> => {
  const playerRef = ref(database, `rooms/${roomCode}/players/${playerId}`);
  const playerSnapshot = await get(playerRef);
  
  if (playerSnapshot.exists()) {
    const playerData = playerSnapshot.val();
    const currentPoints = playerData.points || 0;
    
    console.log(`Assigning ${points} points to player ${playerId}. Current points: ${currentPoints}, New total: ${currentPoints + points}`);
    
    await update(playerRef, {
      points: currentPoints + points
    });
    
    await updateRoomActivity(roomCode);
    await resetBuzz(roomCode);
  }
};

export const subtractPoints = async (roomCode: string, playerId: string, points: number): Promise<void> => {
  const playerRef = ref(database, `rooms/${roomCode}/players/${playerId}`);
  const playerSnapshot = await get(playerRef);
  
  if (playerSnapshot.exists()) {
    const playerData = playerSnapshot.val();
    const currentPoints = playerData.points || 0;
    
    console.log(`Subtracting ${points} points from player ${playerId}. Current points: ${currentPoints}, New total: ${Math.max(0, currentPoints - points)}`);
    
    await update(playerRef, {
      points: Math.max(0, currentPoints - points)
    });
    
    await updateRoomActivity(roomCode);
    await resetBuzz(roomCode);
  }
};

export const rejectPlayerAnswer = async (roomCode: string): Promise<void> => {
  await updateRoomActivity(roomCode);
  await resetBuzz(roomCode);
};

export const addPlayedSong = async (roomCode: string, songName: string): Promise<void> => {
  const roomRef = ref(database, `rooms/${roomCode}/playedSongs`);
  await runTransaction(roomRef, (currentData) => {
    if (currentData) {
      if (!currentData.includes(songName)) {
        return [...currentData, songName];
      } else {
        return undefined;
      }
    } else {
      return [songName];
    }
  });
};

export { database, ref, update };

export default { 
  generateRoomCode,
  checkRoomExists,
  createRoom,
  joinRoom,
  listenToRoom,
  registerBuzz,
  resetBuzz,
  removePlayer,
  assignPoints,
  subtractPoints,
  rejectPlayerAnswer,
  addPlayedSong,
  deleteRoom,
  auth
};
