import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function Callback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code || !state) {
      setError('Missing authorization code. Please try signing in again.');
      return;
    }

    fetch('/auth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ code, state }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Authentication failed');
        return res.json();
      })
      .then(() => {
        navigate('/', { replace: true });
        window.location.reload();
      })
      .catch((err) => setError(err.message));
  }, [searchParams, navigate]);

  if (error) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h2>Authentication Error</h2>
          <p className="error-text">{error}</p>
          <button className="btn btn-primary" onClick={() => navigate('/login')}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="loading-screen">
      <div className="spinner" />
      <p>Completing sign-in...</p>
    </div>
  );
}
