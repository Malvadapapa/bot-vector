import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthLayout } from '../components/templates/AuthLayout';
import { FormField } from '../components/molecules/FormField';
import { OTPInput } from '../components/molecules/OTPInput';
import { Button } from '../components/atoms/Button';
import { Mail, ShieldAlert, ArrowLeft, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const maskEmail = (val: string) => {
  if (!val || !val.includes('@')) return val;
  const [name, domain] = val.split('@');
  if (name.length <= 3) return `***@${domain}`;
  return `${name.substring(0, 3)}***@${domain}`;
};

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

export const LoginPage: React.FC = () => {
  const { requestOTP, verifyOTP, otpDebug, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [otpCode, setOtpCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Timer for resend debounce (60s)
  const [resendTimer, setResendTimer] = useState(0);
  // Timer for OTP expiration (10m = 600s)
  const [expiryTimer, setExpiryTimer] = useState(600);

  // If already logged in, redirect based on role
  useEffect(() => {
    if (isAuthenticated && user) {
      redirectToDashboard(user.role);
    }
  }, [isAuthenticated, user]);

  // Parse query parameters for auto login
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get('email');
    const otpParam = params.get('otp');

    if (emailParam) {
      setEmail(emailParam);
      setStep('otp');
      if (otpParam) {
        setOtpCode(otpParam);
        setIsSubmitting(true);
        verifyOTP(emailParam.trim().toLowerCase(), otpParam)
          .then((success) => {
            if (success) {
              toast.success('¡Sesión iniciada automáticamente!');
            } else {
              toast.error('Enlace de login vencido o OTP incorrecto.');
            }
          })
          .catch(() => {
            toast.error('Error en el login automático.');
          })
          .finally(() => {
            setIsSubmitting(false);
          });
      }
    }
  }, []);

  // Timers countdown
  useEffect(() => {
    let interval: number | undefined;
    if (step === 'otp') {
      interval = window.setInterval(() => {
        setResendTimer((prev) => (prev > 0 ? prev - 1 : 0));
        setExpiryTimer((prev) => {
          if (prev <= 1) {
            toast.error('El código OTP ha expirado. Solicitá uno nuevo.');
            setStep('email');
            setOtpCode('');
            return 600;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [step]);

  const redirectToDashboard = (role: string) => {
    const params = new URLSearchParams(window.location.search);
    const redirectUrl = params.get('redirect');
    if (redirectUrl) {
      navigate(redirectUrl);
      return;
    }

    switch (role) {
      case 'super_admin':
        navigate('/super-admin/groups');
        break;
      case 'group_admin':
        navigate('/admin/calendar');
        break;
      case 'professor':
        navigate('/professor/calendar');
        break;
      case 'institutional':
        navigate('/institutional/notices');
        break;
      default:
        toast.error('Rol desconocido.');
    }
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      toast.error('Por favor, ingresá un correo electrónico válido.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await requestOTP(email.trim().toLowerCase());
      if (res.success) {
        setStep('otp');
        setResendTimer(60);
        setExpiryTimer(600);
        toast.success('Código OTP enviado con éxito a tu email.');
      } else {
        toast.error(res.error || 'No se pudo enviar el OTP. Verificá tu correo.');
      }
    } catch {
      toast.error('Ocurrió un error. Intentá de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async (codeToVerify?: string) => {
    const finalCode = codeToVerify || otpCode;
    if (finalCode.length !== 6) {
      toast.error('El código debe tener 6 dígitos.');
      return;
    }

    setIsSubmitting(true);
    try {
      const success = await verifyOTP(email.trim().toLowerCase(), finalCode);
      if (success) {
        toast.success('¡Sesión iniciada con éxito!');
      } else {
        toast.error('Código OTP incorrecto o expirado.');
      }
    } catch {
      toast.error('Error al verificar código.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendOTP = async () => {
    if (resendTimer > 0) return;
    setIsSubmitting(true);
    try {
      const res = await requestOTP(email.trim().toLowerCase());
      if (res.success) {
        setResendTimer(60);
        setExpiryTimer(600);
        setOtpCode('');
        toast.success('Se reenvió un nuevo código OTP.');
      } else {
        toast.error(res.error || 'Error al reenviar.');
      }
    } catch {
      toast.error('Error al reenviar.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <AuthLayout>
      {step === 'email' ? (
        <form onSubmit={handleSendEmail} className="flex flex-col gap-5 w-full">
          <div className="text-center flex flex-col gap-2">
            <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
              ¡Hola de nuevo!
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Ingresá tu correo para recibir un código de acceso único.
            </p>
          </div>

          <FormField
            label="Correo Electrónico"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ejemplo@universidad.edu.ar"
            icon={<Mail className="w-4.5 h-4.5" />}
            required
            autoComplete="email"
          />

          <Button variant="primary" type="submit" loading={isSubmitting} className="w-full py-2.5 mt-2">
            Enviar Código OTP
          </Button>

          {isLocalhost && (
            <div className="pt-4 border-t border-[var(--color-border)] text-center text-xs text-[var(--color-text-tertiary)]">
              <span className="font-semibold text-[var(--color-text-secondary)]">Cuentas de prueba en seedData:</span>
              <ul className="mt-2 flex flex-col gap-1.5 text-[11px] list-none text-left px-4">
                {[
                  { email: 'super@vectorito.com', label: 'Super Admin' },
                  { email: 'admin@vectorito.com', label: 'Admin Grupo' },
                  { email: 'profe@vectorito.com', label: 'Profesor' },
                  { email: 'institucion@vectorito.com', label: 'Institucional' }
                ].map((account) => (
                  <li key={account.email} className="flex justify-between items-center bg-[var(--color-bg-input)] hover:bg-[var(--color-bg-card-hover)] border border-[var(--color-border)] rounded-md px-2.5 py-1.5 transition-all">
                    <button
                      type="button"
                      onClick={() => setEmail(account.email)}
                      className="text-[var(--color-accent)] hover:underline cursor-pointer font-mono font-medium text-left text-[11px]"
                    >
                      {account.email}
                    </button>
                    <span className="text-[10px] text-[var(--color-text-tertiary)] font-semibold bg-[var(--color-bg-primary)] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
                      {account.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
      ) : (
        <div className="flex flex-col gap-5 w-full">
          <div className="text-center flex flex-col gap-2">
            <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
              Verificá tu correo
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Ingresá el código de 6 dígitos que enviamos a <span className="font-semibold text-[var(--color-text-primary)]">{maskEmail(email)}</span>.
            </p>
          </div>

          <div className="py-2">
            <OTPInput
              value={otpCode}
              onChange={setOtpCode}
              onComplete={(code) => handleVerifyOtp(code)}
              error={false}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)] px-1">
            <span>El código expira en: <span className="font-bold text-[var(--color-text-primary)]">{formatTime(expiryTimer)}</span></span>
            
            <button
              onClick={handleResendOTP}
              disabled={resendTimer > 0 || isSubmitting}
              className={`flex items-center gap-1 font-bold ${resendTimer > 0 ? 'text-[var(--color-text-tertiary)] cursor-not-allowed' : 'text-[var(--color-accent)] hover:underline cursor-pointer'}`}
            >
              <RefreshCw className={`w-3 h-3 ${isSubmitting ? 'animate-spin' : ''}`} />
              {resendTimer > 0 ? `Reenviar en ${resendTimer}s` : 'Reenviar código'}
            </button>
          </div>

          <Button
            variant="primary"
            onClick={() => handleVerifyOtp()}
            loading={isSubmitting}
            disabled={otpCode.length !== 6}
            className="w-full py-2.5"
          >
            Iniciar Sesión
          </Button>

          <button
            onClick={() => {
              setStep('email');
              setOtpCode('');
            }}
            className="flex items-center justify-center gap-1.5 w-full text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:underline cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Cambiar correo electrónico
          </button>
        </div>
      )}
    </AuthLayout>
  );
};
export default LoginPage;
