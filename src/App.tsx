import { HashRouter as Router, Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import Room, { RoomErrorBoundary } from "@/pages/Room";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={
          <RoomErrorBoundary>
            <Room />
          </RoomErrorBoundary>
        } />
      </Routes>
    </Router>
  );
}
