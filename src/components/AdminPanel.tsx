import React, { useState } from 'react';
import { deleteAllRooms, listAllRooms } from '../services/firebase';
import { toast } from 'sonner';

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
      const roomList = await listAllRooms();
      setRooms(roomList);
      toast.success(`Trovate ${roomList.length} stanze attive`);
    } catch (error) {
      console.error('Errore nel recuperare le stanze:', error);
      toast.error('Errore nel recuperare le stanze');
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
      await deleteAllRooms();
      setRooms([]);
      toast.success('Tutte le stanze sono state eliminate con successo!');
    } catch (error) {
      console.error('Errore nell\'eliminare le stanze:', error);
      toast.error('Errore nell\'eliminare le stanze');
    } finally {
      setIsLoading(false);
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
          disabled={isLoading}
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
    </div>
  );
};

export default AdminPanel; 