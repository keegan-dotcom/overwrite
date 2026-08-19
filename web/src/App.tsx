import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Nav } from "./components/Nav";
import { Footer } from "./components/Footer";
import { Landing } from "./pages/Landing";
import { AppDemo } from "./pages/AppDemo";

/* The trade desk is a one-screen app - no marketing footer under it. */
function FooterGate() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/app")) return null;
  return <Footer />;
}

function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      document.querySelector(hash)?.scrollIntoView({ behavior: "smooth" });
    } else {
      window.scrollTo(0, 0);
    }
  }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollManager />
      <Nav />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Navigate to="/app" replace />} />
        <Route path="/app" element={<AppDemo />} />
      </Routes>
      <FooterGate />
    </>
  );
}
