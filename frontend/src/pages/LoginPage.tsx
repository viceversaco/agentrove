import { memo, type ReactNode, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ArrowRight } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/primitives/Button';
import { FieldMessage } from '@/components/ui/primitives/FieldMessage';
import { Input } from '@/components/ui/primitives/Input';
import { Label } from '@/components/ui/primitives/Label';
import { useAuthStore } from '@/store/authStore';
import { useLoginMutation } from '@/hooks/queries/useAuthQueries';
import { isValidEmail } from '@/utils/validation';

interface LoginFormData {
  email: string;
  password: string;
}

type LoginFormErrors = Partial<Record<keyof LoginFormData, string>>;

interface LoginPageLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

const LoginPageLayout = memo(function LoginPageLayout({
  title,
  subtitle,
  children,
}: LoginPageLayoutProps) {
  return (
    <Layout isAuthPage={true}>
      <div className="flex h-full flex-col bg-surface-secondary dark:bg-surface-dark-secondary">
        <div className="flex flex-1 flex-col items-center justify-center p-4">
          <div className="relative z-10 w-full max-w-sm space-y-5">
            <div className="space-y-1.5 text-center">
              <h2 className="animate-fadeIn text-xl font-semibold text-text-primary dark:text-text-dark-primary">
                {title}
              </h2>
              <p className="text-sm text-text-tertiary dark:text-text-dark-tertiary">{subtitle}</p>
            </div>

            <div className="rounded-xl border border-border/50 bg-surface-tertiary p-6 shadow-medium dark:border-border-dark/50 dark:bg-surface-dark-tertiary">
              {children}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
});

const validateForm = (values: LoginFormData): LoginFormErrors | null => {
  const errors: LoginFormErrors = {};

  if (!values.email) {
    errors.email = 'Email is required';
  } else if (!isValidEmail(values.email)) {
    errors.email = 'Invalid email address';
  }

  if (!values.password) {
    errors.password = 'Password is required';
  }

  return Object.keys(errors).length ? errors : null;
};

const getFieldConfigs = (
  onForgotPassword: () => void,
): Array<{
  name: keyof LoginFormData;
  label: string;
  placeholder: string;
  type: 'email' | 'password';
  action?: ReactNode;
}> => [
  {
    name: 'email',
    label: 'Email address',
    placeholder: 'name@example.com',
    type: 'email',
  },
  {
    name: 'password',
    label: 'Password',
    placeholder: 'Enter your password',
    type: 'password',
    action: (
      <Button type="button" variant="link" className="text-xs" onClick={onForgotPassword}>
        Forgot password?
      </Button>
    ),
  },
];

export function LoginPage() {
  const navigate = useNavigate();
  const [values, setValues] = useState<LoginFormData>({ email: '', password: '' });
  const [errors, setErrors] = useState<LoginFormErrors | null>(null);

  const loginMutation = useLoginMutation({
    onSuccess: () => {
      useAuthStore.getState().setAuthenticated(true);
      navigate('/');
    },
  });

  const handleChange = (name: keyof LoginFormData, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev?.[name]) {
        return prev;
      }

      const rest = { ...prev };
      delete rest[name];
      return Object.keys(rest).length ? rest : null;
    });
  };

  const handleForgotPassword = () => {
    navigate('/forgot-password');
  };

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const validationErrors = validateForm(values);
      if (validationErrors) {
        setErrors(validationErrors);
        return;
      }

      setErrors(null);
      const attemptValues = { ...values };
      loginMutation.mutate(
        {
          username: attemptValues.email,
          password: attemptValues.password,
        },
        {
          onError: (error) => {
            if (error.message.includes('Email not verified')) {
              sessionStorage.setItem('pending_verification_email', attemptValues.email);
              navigate('/verify-email');
            }
          },
        },
      );
    },
    [loginMutation, navigate, values],
  );

  const title = 'Welcome to Agentrove';
  const subtitle = 'Sign in to continue to your account';

  const isSubmitting = loginMutation.isPending;
  const error = loginMutation.error?.message;
  const fieldConfigs = getFieldConfigs(handleForgotPassword);

  return (
    <LoginPageLayout title={title} subtitle={subtitle}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="animate-fadeIn rounded-lg border border-error-500/20 bg-error-500/10 p-3">
            <p className="text-xs font-medium text-error-600 dark:text-error-400">{error}</p>
          </div>
        )}

        <div className="space-y-3.5">
          {fieldConfigs.map(({ name, label, placeholder, type, action }) => (
            <div key={name} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor={name}
                  className="text-xs text-text-secondary dark:text-text-dark-secondary"
                >
                  {label}
                </Label>
                {action}
              </div>
              <Input
                id={name}
                type={type}
                value={values[name]}
                onChange={(e) => handleChange(name, e.target.value)}
                placeholder={placeholder}
                autoComplete={type === 'password' ? 'current-password' : 'email'}
                hasError={Boolean(errors?.[name])}
              />
              <FieldMessage variant="error">{errors?.[name]}</FieldMessage>
            </div>
          ))}
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="mt-5 w-full"
          isLoading={isSubmitting}
          loadingText="Signing in..."
          loadingIcon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
        >
          <span>Sign in</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </form>

      <div className="pt-4 text-center">
        <Button
          type="button"
          variant="link"
          className="text-xs"
          onClick={() => navigate('/signup')}
        >
          Don{'\u2019'}t have an account? Create one
        </Button>
      </div>
    </LoginPageLayout>
  );
}
