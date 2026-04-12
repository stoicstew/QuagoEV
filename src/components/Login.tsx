import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <span className="logo-icon">⚡</span>
          <h1>QuagoEV</h1>
          <p className="login-subtitle">Tesla Ownership Intelligence</p>
        </div>
        <div className="login-features">
          <div className="feature-pill">Battery Health</div>
          <div className="feature-pill">Cost Analytics</div>
          <div className="feature-pill">Trip Logging</div>
          <div className="feature-pill">Smart Automations</div>
          <div className="feature-pill">Sleep Score</div>
        </div>
        <button className="btn btn-primary btn-lg" onClick={login}>
          Sign in with Tesla
        </button>
        <p className="login-disclaimer">
          Connects securely via Tesla's official Fleet API.
          <br />
          Your credentials are never stored by QuagoEV.
        </p>
      </div>
    </div>
  );
}
