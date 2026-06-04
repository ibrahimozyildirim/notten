import React, { useState, useEffect, useCallback, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc, 
  serverTimestamp,
  query
} from 'firebase/firestore';
import { 
  Plus, 
  Settings, 
  Moon, 
  Sun, 
  Search, 
  Tag, 
  X, 
  ArrowLeft, 
  Trash2, 
  CheckCircle2,
  Menu,
  User,
  Lock,
  Mail,
  LogOut
} from 'lucide-react';

// --- Firebase Başlatma ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Tema Tanımlamaları ---
const THEMES = {
  emerald: { name: 'Zümrüt Yeşili', primary: 'bg-emerald-500', text: 'text-emerald-500', border: 'border-emerald-500', hover: 'hover:bg-emerald-600', ring: 'ring-emerald-500', lightBg: 'bg-emerald-500/10' },
  blue: { name: 'Okyanus Mavisi', primary: 'bg-blue-500', text: 'text-blue-500', border: 'border-blue-500', hover: 'hover:bg-blue-600', ring: 'ring-blue-500', lightBg: 'bg-blue-500/10' },
  purple: { name: 'Ametist Moru', primary: 'bg-purple-500', text: 'text-purple-500', border: 'border-purple-500', hover: 'hover:bg-purple-600', ring: 'ring-purple-500', lightBg: 'bg-purple-500/10' },
  amber: { name: 'Kehribar', primary: 'bg-amber-500', text: 'text-amber-500', border: 'border-amber-500', hover: 'hover:bg-amber-600', ring: 'ring-amber-500', lightBg: 'bg-amber-500/10' },
  rose: { name: 'Gül Kurusu', primary: 'bg-rose-500', text: 'text-rose-500', border: 'border-rose-500', hover: 'hover:bg-rose-600', ring: 'ring-rose-500', lightBg: 'bg-rose-500/10' }
};

const CATEGORIES = ["Ders", "İş", "Oyun", "Mail", "Şifre", "Hesaplar", "Genel"];

// --- Yapay Zeka (Gemini) Etiketleme Fonksiyonu ---
const analyzeNoteAndGetTag = async (content) => {
  if (!content || content.length < 10) return "Genel"; 
  
  const apiKey = ""; // Sistem tarafından sağlanır
  const prompt = `Aşağıdaki not içeriğini analiz et ve şu kategorilerden EN UYGUN OLAN SADECE BİR TANESİNİ seç: ${CATEGORIES.join(', ')}. Sadece kategori adını döndür, nokta veya başka kelime kullanma.\n\nNot İçeriği:\n${content}`;
  
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    
    const data = await response.json();
    const tag = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    if (tag && CATEGORIES.includes(tag)) {
      return tag;
    }
    return "Genel";
  } catch (error) {
    console.error("AI Etiketleme Hatası:", error);
    return "Genel";
  }
};

export default function App() {
  // --- State Tanımlamaları ---
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [notes, setNotes] = useState([]);
  const [currentNote, setCurrentNote] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [activeTheme, setActiveTheme] = useState('emerald');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('Tümü');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Senkronize');

  // --- Auth (Giriş/Kayıt) State'leri ---
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isAuthProcessing, setIsAuthProcessing] = useState(false);

  const theme = THEMES[activeTheme];

  // --- Auth & Initial Data Fetching ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          // Canvas (Önizleme) ortamındaysak otomatik giriş yap
          await signInWithCustomToken(auth, __initial_auth_token);
        }
        // Not: Gerçek uygulamada kullanıcıyı otomatik misafir yapmıyoruz ki Giriş ekranını görsün.
      } catch (err) {
        console.error("Auth error:", err);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const notesRef = collection(db, 'artifacts', appId, 'users', user.uid, 'notes');
    const q = query(notesRef);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedNotes = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        updatedAt: doc.data().updatedAt?.toDate() || new Date(),
        createdAt: doc.data().createdAt?.toDate() || new Date(),
      }));
      
      fetchedNotes.sort((a, b) => b.updatedAt - a.updatedAt);
      setNotes(fetchedNotes);
    }, (error) => {
      console.error("Firestore okuma hatası:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // --- Otomatik Kaydetme (Debounce) Mantığı ---
  useEffect(() => {
    if (!currentNote || !currentNote.isDirty || !user) return;

    setSyncStatus('Kaydediliyor...');
    
    const saveTimeout = setTimeout(async () => {
      const noteRef = doc(db, 'artifacts', appId, 'users', user.uid, 'notes', currentNote.id);
      
      const noteToSave = {
        title: currentNote.title,
        content: currentNote.content,
        tag: currentNote.tag || "Genel",
        updatedAt: serverTimestamp(),
      };

      if (currentNote.isNew) {
        noteToSave.createdAt = serverTimestamp();
      }

      try {
        await setDoc(noteRef, noteToSave, { merge: true });
        setSyncStatus('Senkronize');
        setCurrentNote(prev => prev ? { ...prev, isDirty: false, isNew: false } : null);
      } catch (error) {
        console.error("Kaydetme hatası:", error);
        setSyncStatus('Hata!');
      }
    }, 1000);

    return () => clearTimeout(saveTimeout);
  }, [currentNote?.title, currentNote?.content, user]);


  // --- Kimlik Doğrulama Fonksiyonları ---
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setAuthError('Lütfen e-posta ve şifre girin.');
      return;
    }
    
    setIsAuthProcessing(true);
    setAuthError('');

    try {
      if (isLoginMode) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      // Başarılı olursa onAuthStateChanged otomatik tetiklenir ve user dolar.
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setAuthError('E-posta veya şifre hatalı.');
      } else if (err.code === 'auth/email-already-in-use') {
        setAuthError('Bu e-posta adresi zaten kullanılıyor.');
      } else if (err.code === 'auth/weak-password') {
        setAuthError('Şifre en az 6 karakter olmalıdır.');
      } else if (err.code === 'auth/invalid-email') {
        setAuthError('Geçersiz bir e-posta formatı girdiniz.');
      } else {
        setAuthError('Bir hata oluştu: ' + err.message);
      }
    } finally {
      setIsAuthProcessing(false);
    }
  };

  const handleGuestLogin = async () => {
    setIsAuthProcessing(true);
    try {
      await signInAnonymously(auth);
    } catch (err) {
      setAuthError('Misafir girişi yapılamadı.');
    } finally {
      setIsAuthProcessing(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setIsSettingsOpen(false);
    } catch (err) {
      console.error("Çıkış hatası", err);
    }
  };

  // --- AI Etiketleme ---
  const handleCloseNote = async () => {
    if (currentNote && currentNote.content.trim().length > 0 && currentNote.isDirtyAI) {
       const newTag = await analyzeNoteAndGetTag(currentNote.content);
       if (user && currentNote.id) {
          const noteRef = doc(db, 'artifacts', appId, 'users', user.uid, 'notes', currentNote.id);
          await setDoc(noteRef, { tag: newTag, updatedAt: serverTimestamp() }, { merge: true });
       }
    }
    setCurrentNote(null);
  };

  // --- Not İşlemleri ---
  const handleCreateNote = () => {
    const newNote = {
      id: crypto.randomUUID(),
      title: '',
      content: '',
      tag: 'Genel',
      isNew: true,
      isDirty: false,
      isDirtyAI: false,
      updatedAt: new Date(),
    };
    setCurrentNote(newNote);
  };

  const handleDeleteNote = async (id, e) => {
    if (e) e.stopPropagation();
    if (!user) return;
    
    if (currentNote && currentNote.id === id) {
      setCurrentNote(null);
    }
    
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'notes', id));
    } catch (error) {
      console.error("Silme hatası:", error);
    }
  };

  const updateCurrentNote = (field, value) => {
    setCurrentNote(prev => ({
      ...prev,
      [field]: value,
      isDirty: true,
      isDirtyAI: field === 'content' ? true : prev.isDirtyAI
    }));
  };

  // --- Filtreleme ---
  const filteredNotes = notes.filter(note => {
    const matchesSearch = note.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          note.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTag = selectedTag === 'Tümü' || note.tag === selectedTag;
    return matchesSearch && matchesTag;
  });

  // --- Tasarım Sınıfları ---
  const bgClass = isDarkMode ? 'bg-gray-950' : 'bg-gray-50';
  const textClass = isDarkMode ? 'text-gray-100' : 'text-gray-900';
  const cardBgClass = isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200';
  const sidebarBgClass = isDarkMode ? 'bg-gray-900/50' : 'bg-gray-100/50';

  // Yükleniyor Ekranı
  if (authLoading) {
    return (
      <div className={`min-h-screen ${bgClass} flex items-center justify-center`}>
        <div className={`w-12 h-12 rounded-xl ${theme.primary} animate-pulse flex items-center justify-center text-white font-bold text-2xl`}>N</div>
      </div>
    );
  }

  // --- GİRİŞ / KAYIT EKRANI ---
  if (!user) {
    return (
      <div className={`min-h-screen ${bgClass} flex items-center justify-center p-4 transition-colors duration-300`}>
        <div className={`w-full max-w-md p-8 rounded-3xl border ${cardBgClass} shadow-2xl flex flex-col items-center animate-in zoom-in-95`}>
          <div className={`w-16 h-16 rounded-2xl ${theme.primary} flex items-center justify-center text-white font-bold text-3xl mb-6 shadow-lg`}>
            N
          </div>
          <h1 className={`text-2xl font-bold mb-2 ${textClass}`}>NOTTEN'a Hoş Geldin</h1>
          <p className="text-gray-500 text-sm mb-8 text-center">Senkronize ve akıllı not alma deneyimi için giriş yap veya yeni hesap oluştur.</p>

          <form onSubmit={handleAuthSubmit} className="w-full space-y-4">
            {authError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm font-medium text-center">
                {authError}
              </div>
            )}
            
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${isDarkMode ? 'bg-gray-950 border-gray-800 focus-within:border-gray-700' : 'bg-gray-50 border-gray-200 focus-within:border-gray-400'} transition-colors`}>
              <Mail size={20} className="text-gray-500" />
              <input 
                type="email" 
                placeholder="E-posta Adresin" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-transparent border-none outline-none w-full text-sm md:text-base placeholder-gray-500"
                required
              />
            </div>

            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${isDarkMode ? 'bg-gray-950 border-gray-800 focus-within:border-gray-700' : 'bg-gray-50 border-gray-200 focus-within:border-gray-400'} transition-colors`}>
              <Lock size={20} className="text-gray-500" />
              <input 
                type="password" 
                placeholder="Şifren (En az 6 karakter)" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-transparent border-none outline-none w-full text-sm md:text-base placeholder-gray-500"
                required
              />
            </div>

            <button 
              type="submit" 
              disabled={isAuthProcessing}
              className={`w-full py-3.5 rounded-xl text-white font-medium shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 ${theme.primary} ${theme.hover} ${isAuthProcessing ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isAuthProcessing ? 'İşleniyor...' : (isLoginMode ? 'Giriş Yap' : 'Kayıt Ol ve Başla')}
            </button>
          </form>

          <div className="mt-6 flex flex-col items-center gap-4 w-full">
            <button 
              onClick={() => { setIsLoginMode(!isLoginMode); setAuthError(''); }}
              className={`text-sm font-medium transition-colors ${theme.text} hover:opacity-80`}
            >
              {isLoginMode ? "Hesabın yok mu? Hemen Kayıt Ol" : "Zaten hesabın var mı? Giriş Yap"}
            </button>

            <div className="w-full flex items-center gap-4">
              <div className={`flex-1 h-px ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
              <span className="text-xs text-gray-500 uppercase font-semibold tracking-wider">VEYA</span>
              <div className={`flex-1 h-px ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
            </div>

            <button 
              onClick={handleGuestLogin}
              disabled={isAuthProcessing}
              className={`w-full py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2 border ${isDarkMode ? 'bg-gray-900 border-gray-700 hover:bg-gray-800 text-gray-300' : 'bg-white border-gray-300 hover:bg-gray-50 text-gray-700'}`}
            >
              <User size={18} /> Misafir Olarak Devam Et
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- ANA UYGULAMA EKRANI ---
  return (
    <div className={`min-h-screen ${bgClass} ${textClass} font-sans transition-colors duration-300 flex flex-col md:flex-row overflow-hidden`}>
      
      {/* --- SOL MENÜ (Sidebar) --- */}
      <div className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:static inset-y-0 left-0 z-40 w-64 ${sidebarBgClass} border-r ${isDarkMode ? 'border-gray-800' : 'border-gray-200'} transition-transform duration-300 ease-in-out flex flex-col backdrop-blur-xl md:backdrop-blur-none`}>
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg ${theme.primary} flex items-center justify-center text-white font-bold text-xl`}>
              N
            </div>
            <h1 className="text-2xl font-bold tracking-tight">NOTTEN</h1>
          </div>
          <button className="md:hidden" onClick={() => setIsSidebarOpen(false)}>
            <X size={24} className="text-gray-500" />
          </button>
        </div>

        <div className="flex-1 px-4 py-2 overflow-y-auto">
          <h2 className={`text-xs font-semibold uppercase tracking-wider mb-4 px-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Etiketler</h2>
          <div className="space-y-1">
            <button
              onClick={() => { setSelectedTag('Tümü'); setIsSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${selectedTag === 'Tümü' ? `${theme.lightBg} ${theme.text} font-medium` : `text-gray-500 hover:${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}`}
            >
              <Tag size={18} />
              <span>Tümü</span>
            </button>
            {CATEGORIES.map(category => (
              <button
                key={category}
                onClick={() => { setSelectedTag(category); setIsSidebarOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${selectedTag === category ? `${theme.lightBg} ${theme.text} font-medium` : `text-gray-500 hover:${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}`}
              >
                <div className={`w-2 h-2 rounded-full ${theme.primary}`}></div>
                <span>{category}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-transparent">
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-500 hover:${isDarkMode ? 'bg-gray-800 text-gray-200' : 'bg-gray-200 text-gray-800'} transition-all`}
          >
            <Settings size={20} />
            <span className="font-medium">Ayarlar</span>
          </button>
        </div>
      </div>

      {/* MOBİL ARKA PLAN KARARTMASI */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setIsSidebarOpen(false)}></div>
      )}


      {/* --- ANA İÇERİK ALANI --- */}
      <div className="flex-1 flex flex-col h-screen relative overflow-hidden">
        
        {/* Üst Bar */}
        <header className="px-4 md:px-6 py-3 md:py-4 flex items-center gap-3 md:gap-4">
          <button className="md:hidden p-2 -ml-2 text-gray-500" onClick={() => setIsSidebarOpen(true)}>
            <Menu size={24} />
          </button>
          
          <div className={`flex-1 flex items-center gap-2 md:gap-3 px-4 py-2 md:py-2.5 rounded-2xl border ${isDarkMode ? 'bg-gray-900 border-gray-800 focus-within:border-gray-700' : 'bg-white border-gray-200 focus-within:border-gray-300'} transition-colors`}>
            <Search size={18} className="text-gray-400" />
            <input 
              type="text" 
              placeholder="Notlarda ara..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none outline-none w-full text-sm md:text-base placeholder-gray-500"
            />
          </div>
          
          <div className="hidden md:flex items-center gap-2 text-xs font-medium text-gray-500 bg-gray-500/10 px-3 py-1.5 rounded-full">
            {syncStatus === 'Kaydediliyor...' ? (
              <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span> Kaydediliyor...</span>
            ) : (
              <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className={theme.text} /> Senkronize</span>
            )}
          </div>
        </header>

        {/* Not Listesi (Grid) */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pt-2">
          {filteredNotes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-4">
              <div className={`w-20 h-20 rounded-full ${theme.lightBg} flex items-center justify-center mb-2`}>
                <Tag size={32} className={theme.text} />
              </div>
              <p className="text-lg font-medium text-center">Buralar çok sessiz.</p>
              <p className="text-sm text-center max-w-xs">Sağ alttaki butona tıklayarak yeni bir not oluşturabilirsin.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4 pb-28 md:pb-24">
              {filteredNotes.map(note => (
                <div 
                  key={note.id}
                  onClick={() => setCurrentNote({...note, isDirty: false, isDirtyAI: false})}
                  className={`group relative p-5 rounded-3xl border ${cardBgClass} hover:shadow-lg transition-all duration-300 cursor-pointer flex flex-col h-64 overflow-hidden`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${theme.lightBg} ${theme.text}`}>
                      {note.tag || 'Genel'}
                    </span>
                    <button 
                      onClick={(e) => handleDeleteNote(note.id, e)}
                      className={`p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/10 text-gray-400 hover:text-red-500`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <h3 className="font-semibold text-lg mb-2 line-clamp-1">{note.title || 'Başlıksız Not'}</h3>
                  <p className="text-gray-500 text-sm line-clamp-5 flex-1 whitespace-pre-wrap">
                    {note.content || 'İçerik yok...'}
                  </p>
                  <div className="mt-4 text-xs text-gray-600 font-medium">
                    {note.updatedAt.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>

        {/* FAB Butonu */}
        <button 
          onClick={handleCreateNote}
          className={`absolute bottom-6 right-6 md:bottom-8 md:right-8 w-14 h-14 md:w-16 md:h-16 rounded-2xl md:rounded-3xl ${theme.primary} ${theme.hover} text-white shadow-xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95 z-20`}
        >
          <Plus className="w-8 h-8 md:w-10 md:h-10" />
        </button>

      </div>

      {/* --- NOT DÜZENLEME EKRANI (Fullscreen Modal) --- */}
      {currentNote && (
        <div className={`fixed inset-0 z-50 ${bgClass} flex flex-col transition-colors duration-300 animate-in slide-in-from-bottom-4`}>
          <header className={`px-2 md:px-4 py-2 md:py-3 flex items-center justify-between border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className="flex items-center gap-1 md:gap-2">
              <button 
                onClick={handleCloseNote}
                className={`p-2 rounded-xl hover:${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'} transition-colors`}
              >
                <ArrowLeft size={24} />
              </button>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-500/10 text-sm font-medium text-gray-500">
                {syncStatus === 'Kaydediliyor...' ? 'Kaydediliyor...' : 'Kaydedildi'}
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <span className={`text-xs font-medium px-3 py-1.5 rounded-full ${theme.lightBg} ${theme.text} flex items-center gap-1.5`}>
                <Tag size={14} /> {currentNote.tag || 'Genel'}
              </span>
              <button 
                onClick={() => { handleDeleteNote(currentNote.id); handleCloseNote(); }}
                className="p-2 rounded-xl text-red-400 hover:bg-red-500/10 transition-colors"
                title="Notu Sil"
              >
                <Trash2 size={18} className="md:w-5 md:h-5" />
              </button>
            </div>
          </header>
          
          <main className="flex-1 overflow-y-auto p-5 md:p-12 pb-32 md:pb-12 max-w-4xl mx-auto w-full flex flex-col">
            <input
              type="text"
              placeholder="Not Başlığı"
              value={currentNote.title}
              onChange={(e) => updateCurrentNote('title', e.target.value)}
              className={`text-3xl md:text-5xl font-bold bg-transparent border-none outline-none w-full mb-4 md:mb-6 placeholder-gray-600 ${textClass}`}
            />
            <textarea
              placeholder="Bir şeyler yazmaya başla..."
              value={currentNote.content}
              onChange={(e) => updateCurrentNote('content', e.target.value)}
              className={`flex-1 text-base md:text-xl leading-relaxed bg-transparent border-none outline-none resize-none placeholder-gray-600 ${textClass}`}
              autoFocus
            />
          </main>
        </div>
      )}

      {/* --- AYARLAR MODALI --- */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsSettingsOpen(false)}></div>
          
          <div className={`relative w-full max-w-md rounded-3xl ${cardBgClass} shadow-2xl overflow-hidden animate-in zoom-in-95`}>
            <div className={`p-6 border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-200'} flex justify-between items-center`}>
              <h2 className="text-xl font-bold">Ayarlar</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="p-2 rounded-full hover:bg-gray-500/20">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-8">
              
              {/* Kullanıcı Bilgisi */}
              <div className={`p-4 rounded-2xl border ${isDarkMode ? 'border-gray-800 bg-gray-900/50' : 'border-gray-200 bg-gray-50'} flex flex-col gap-3`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full ${theme.lightBg} flex items-center justify-center`}>
                    <User size={20} className={theme.text} />
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-0.5">Mevcut Hesap</div>
                    <div className="font-medium">{user.isAnonymous ? 'Misafir Kullanıcı' : user.email}</div>
                  </div>
                </div>
                <button 
                  onClick={handleLogout}
                  className="w-full mt-2 py-2.5 rounded-xl text-red-500 bg-red-500/10 hover:bg-red-500/20 font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <LogOut size={18} /> Hesaptan Çıkış Yap
                </button>
              </div>

              {/* Görünüm Modu */}
              <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Görünüm</h3>
                <div className={`flex p-1 rounded-2xl ${isDarkMode ? 'bg-gray-950' : 'bg-gray-100'}`}>
                  <button 
                    onClick={() => setIsDarkMode(false)}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-all ${!isDarkMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <Sun size={18} /> Gündüz
                  </button>
                  <button 
                    onClick={() => setIsDarkMode(true)}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-all ${isDarkMode ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                    <Moon size={18} /> Gece
                  </button>
                </div>
              </div>

              {/* Tema Renkleri */}
              <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Tema Rengi</h3>
                <div className="flex flex-wrap gap-4">
                  {Object.entries(THEMES).map(([key, t]) => (
                    <button
                      key={key}
                      onClick={() => setActiveTheme(key)}
                      title={t.name}
                      className={`w-12 h-12 rounded-full ${t.primary} flex items-center justify-center transition-transform hover:scale-110 ${activeTheme === key ? `ring-4 ring-offset-2 ${isDarkMode ? 'ring-offset-gray-900' : 'ring-offset-white'} ${t.ring}` : ''}`}
                    >
                      {activeTheme === key && <CheckCircle2 size={24} className="text-white" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-4 text-center text-xs text-gray-500">
                NOTTEN v1.1 &bull; E-posta Girişi Aktif
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}