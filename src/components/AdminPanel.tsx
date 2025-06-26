import React, { useState } from 'react';
import { toast } from 'sonner';
import { ref, get, set } from 'firebase/database';
import { database } from '../services/firebase';

interface RoomInfo {
  roomCode: string;
  hostName: string;
  playerCount: number;
  createdAt: number;
}

const AdminPanel: React.FC = () => {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleListRooms = async () => {
    setIsLoading(true);
    try {
      console.log('🔍 Recupero lista stanze...');
      
      // Accesso diretto al database Firebase
      const roomsRef = ref(database, 'rooms');
      const snapshot = await get(roomsRef);
      
      if (snapshot.exists()) {
        const rooms = snapshot.val();
        const roomList = Object.entries(rooms).map(([roomCode, roomData]: [string, any]) => ({
          roomCode,
          hostName: roomData.hostName || 'Host sconosciuto',
          playerCount: roomData.players ? Object.keys(roomData.players).length : 0,
          createdAt: roomData.createdAt || 0
        }));
        
        console.log(`📋 Trovate ${roomList.length} stanze attive`);
        setRooms(roomList);
        toast.success(`Trovate ${roomList.length} stanze attive`);
      } else {
        console.log('📭 Nessuna stanza trovata nel database');
        setRooms([]);
        toast.info('Nessuna stanza trovata');
      }
    } catch (error) {
      console.error('❌ Errore nel recuperare le stanze:', error);
      toast.error(`Errore nel recuperare le stanze: ${error.message}`);
      
      // Prova un approccio alternativo con mock data per il debug
      console.log('🔧 Tentativo con dati di test...');
      const mockRooms: RoomInfo[] = [
        {
          roomCode: 'TEST',
          hostName: 'Test Host',
          playerCount: 0,
          createdAt: Date.now()
        }
      ];
      setRooms(mockRooms);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAllRooms = async () => {
    if (!window.confirm('Sei sicuro di voler eliminare TUTTE le stanze attive? Questa azione non può essere annullata.')) {
      return;
    }

    setIsLoading(true);
    try {
      console.log('🗑️ Eliminazione di tutte le stanze...');
      
      // Elimina tutte le stanze
      const roomsRef = ref(database, 'rooms');
      await set(roomsRef, null);
      
      console.log('✅ Tutte le stanze eliminate con successo');
      setRooms([]);
      toast.success('Tutte le stanze sono state eliminate con successo!');
    } catch (error) {
      console.error('❌ Errore nell\'eliminare le stanze:', error);
      toast.error(`Errore nell\'eliminare le stanze: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSingleRoom = async (roomCode: string) => {
    if (!window.confirm(`Sei sicuro di voler eliminare la stanza ${roomCode}?`)) {
      return;
    }

    try {
      console.log(`🗑️ Eliminazione stanza ${roomCode}...`);
      
      const roomRef = ref(database, `rooms/${roomCode}`);
      await set(roomRef, null);
      
      // Rimuovi dalla lista locale
      setRooms(prev => prev.filter(room => room.roomCode !== roomCode));
      
      console.log(`✅ Stanza ${roomCode} eliminata con successo`);
      toast.success(`Stanza ${roomCode} eliminata con successo!`);
    } catch (error) {
      console.error(`❌ Errore nell'eliminare la stanza ${roomCode}:`, error);
      toast.error(`Errore nell'eliminare la stanza ${roomCode}: ${error.message}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white/10 backdrop-blur-md rounded-xl shadow-lg border border-white/20">
      <h2 className="text-2xl font-bold text-white mb-6">🔧 Pannello Amministrazione</h2>
      
      <div className="flex gap-4 mb-6">
        <button
          onClick={handleListRooms}
          disabled={isLoading}
          className="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg transition-colors border border-blue-500/30 disabled:opacity-50"
        >
          📋 Lista Stanze Attive
        </button>
        
        <button
          onClick={handleDeleteAllRooms}
          disabled={isLoading || rooms.length === 0}
          className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors border border-red-500/30 disabled:opacity-50"
        >
          🗑️ Elimina Tutte le Stanze
        </button>
      </div>

      {isLoading && (
        <div className="text-center py-4">
          <div className="text-white">Caricamento...</div>
        </div>
      )}

      {rooms.length > 0 && (
        <div className="bg-white/5 rounded-lg overflow-hidden">
          <h3 className="text-lg font-semibold text-white p-4 bg-white/10">
            📋 Stanze Attive ({rooms.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-white/10">
                  <th className="p-3 text-left text-white">Codice Stanza</th>
                  <th className="p-3 text-left text-white">Host</th>
                  <th className="p-3 text-left text-white">Giocatori</th>
                  <th className="p-3 text-left text-white">Creata</th>
                  <th className="p-3 text-left text-white">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room, index) => (
                  <tr key={room.roomCode} className={index % 2 === 0 ? 'bg-white/5' : 'bg-transparent'}>
                    <td className="p-3 text-white font-mono">{room.roomCode}</td>
                    <td className="p-3 text-white">{room.hostName}</td>
                    <td className="p-3 text-white">{room.playerCount}</td>
                    <td className="p-3 text-white text-sm">
                      {new Date(room.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => handleDeleteSingleRoom(room.roomCode)}
                        className="px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded text-sm transition-colors border border-red-500/30"
                      >
                        🗑️ Elimina
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rooms.length === 0 && !isLoading && (
        <div className="text-center py-8 text-gray-400">
          📭 Nessuna stanza trovata. Clicca "Lista Stanze Attive" per aggiornare.
        </div>
      )}

      {/* Debug Info */}
      <div className="mt-6 p-4 bg-gray-800/20 rounded-lg">
        <h4 className="text-white font-semibold mb-2">🔧 Debug Info</h4>
        <p className="text-gray-300 text-sm">
          Database URL: {database.app.options.databaseURL}
        </p>
        <p className="text-gray-300 text-sm">
          Ultimo aggiornamento: {new Date().toLocaleString()}
        </p>
      </div>
    </div>
  );
};

export default AdminPanel; 