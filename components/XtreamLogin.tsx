import React, { useState } from 'react';
import { XtreamCredentials } from '../types.ts';
import { Server, User, Key, AlertCircle, X } from 'lucide-react';

interface XtreamLoginProps {
  onLogin: (creds: XtreamCredentials) => Promise<void>;
  onClose: () => void;
}

const XtreamLogin: React.FC<XtreamLoginProps> = ({ onLogin, onClose }) => {
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!url || !username || !password) {
        setError("All fields are required");
        setLoading(false);
        return;
    }

    try {
      await onLogin({ url: url.trim(), username: username.trim(), password: password.trim() });
      onClose();
    } catch (err: any) {
      setError(err.message || "Connection failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-6 animate-fade-in">
      <div className="bg-gray-900/80 backdrop-blur-xl border border-white/10 w-full max-w-md p-8 rounded-3xl shadow-[0_0_100px_rgba(100,0,255,0.1)] relative animate-slide-up">
        <button onClick={onClose} className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors">
            <X className="w-6 h-6" />
        </button>

        <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 mb-4 shadow-lg">
                <Server className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-3xl font-bold text-white tracking-tight">Connect Server</h2>
            <p className="text-gray-400 text-sm mt-2">Xtream Codes API</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
            {[
                { icon: Server, val: url, set: setUrl, pl: "http://host:port", type: "url", label: "Host URL" },
                { icon: User, val: username, set: setUsername, pl: "Username", type: "text", label: "Username" },
                { icon: Key, val: password, set: setPassword, pl: "Password", type: "password", label: "Password" }
            ].map((f, i) => (
                <div key={i} className="group">
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5 ml-1 uppercase tracking-wider">{f.label}</label>
                    <div className="relative">
                        <f.icon className="absolute left-4 top-3.5 w-5 h-5 text-gray-500 group-focus-within:text-purple-400 transition-colors" />
                        <input 
                            type={f.type} 
                            placeholder={f.pl}
                            className="w-full bg-black/50 text-white rounded-xl py-3 pl-12 pr-4 border border-white/10 focus:border-purple-500 focus:bg-black/80 focus:ring-1 focus:ring-purple-500 outline-none transition-all placeholder:text-gray-700"
                            value={f.val}
                            onChange={(e) => f.set(e.target.value)}
                        />
                    </div>
                </div>
            ))}

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-200 p-4 rounded-xl text-sm flex gap-3 items-center">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            <button 
                type="submit" 
                disabled={loading}
                className="tv-focus w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 rounded-xl shadow-lg shadow-purple-900/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2 mt-4 text-lg"
            >
                {loading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : "Connect"}
            </button>
        </form>
      </div>
    </div>
  );
};

export default XtreamLogin;