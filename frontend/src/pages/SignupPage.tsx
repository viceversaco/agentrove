import { memo, type ReactNode, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ArrowRight } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/primitives/Button';
import { FieldMessage } from '@/components/ui/primitives/FieldMessage';
import { Input } from '@/components/ui/primitives/Input';
import { Label } from '@/components/ui/primitives/Label';
import { useSignupMutation } from '@/hooks/queries/useAuthQueries';
import { isValidEmail, isValidUsername, isValidPassword } from '@/utils/validation';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/authService';

interface SignupFormData {
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
}

type SignupFormErrors = Partial<Record<keyof SignupFormData, string>>;

interface SignupPageLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

const SignupPageLayout = memo(function SignupPageLayout({
  title,
  subtitle,
  children,
}: SignupPageLayoutProps) {
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

const validateForm = (values: SignupFormData): SignupFormErrors | null => {
  const errors: SignupFormErrors = {};

  if (!values.email) {
    errors.email = 'Email is required';
  } else if (!isValidEmail(values.email)) {
    errors.email = 'Invalid email address';
  }

  if (!values.username) {
    errors.username = 'Username is required';
  } else if (!isValidUsername(values.username)) {
    errors.username =
      'Username must be 3-30 characters, contain only letters, numbers, and underscores, and cannot start or end with underscore';
  }

  if (!values.password) {
    errors.password = 'Password is required';
  } else if (!isValidPassword(values.password)) {
    errors.password = 'Password must be at least 8 characters';
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = 'Please confirm your password';
  } else if (values.confirmPassword !== values.password) {
    errors.confirmPassword = 'Passwords do not match';
  }

  return Object.keys(errors).length ? errors : null;
};

export function SignupPage() {
  const navigate = useNavigate();
  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
  const [values, setValues] = useState<SignupFormData>({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<SignupFormErrors | null>(null);

  const signupMutation = useSignupMutation({
    onSuccess: (user) => {
      const needsVerification = user.email_verification_required && !user.is_verified;
      if (!needsVerification && authService.isAuthenticated()) {
        setAuthenticated(true);
        navigate('/');
      } else {
        navigate(`/verify-email?email=${encodeURIComponent(user.email)}`);
      }
    },
  });

  const handleChange = useCallback((name: keyof SignupFormData, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev?.[name]) {
        return prev;
      }

      const rest = { ...prev };
      delete rest[name];
      return Object.keys(rest).length ? rest : null;
    });
  }, []);

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
      const signupData: Omit<SignupFormData, 'confirmPassword'> = {
        email: attemptValues.email,
        username: attemptValues.username,
        password: attemptValues.password,
      };
      signupMutation.mutate(signupData);
    },
    [signupMutation, values],
  );

  const title = 'Join Claudex';
  const subtitle = 'Create your claudex account';

  const isSubmitting = signupMutation.isPending;
  const error = signupMutation.error?.message;

  const fieldConfigs = useMemo<
    Array<{
      name: keyof SignupFormData;
      label: string;
      placeholder: string;
      type: 'email' | 'text' | 'password';
      helperText?: string;
    }>
  >(
    () => [
      {
        name: 'email',
        label: 'Email address',
        placeholder: 'name@example.com',
        type: 'email',
      },
      {
        name: 'username',
        label: 'Username',
        placeholder: 'your_username',
        type: 'text',
        helperText:
          '3-30 characters. Letters, numbers, and underscores only. Cannot start or end with an underscore.',
      },
      {
        name: 'password',
        label: 'Password',
        placeholder: 'Enter your password',
        type: 'password',
      },
      {
        name: 'confirmPassword',
        label: 'Confirm Password',
        placeholder: 'Confirm your password',
        type: 'password',
      },
    ],
    [],
  );

  return (
    <SignupPageLayout title={title} subtitle={subtitle}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="animate-fadeIn rounded-lg border border-error-500/20 bg-error-500/10 p-3">
            <p className="text-xs font-medium text-error-600 dark:text-error-400">{error}</p>
          </div>
        )}

        <div className="space-y-3.5">
          {fieldConfigs.map(({ name, label, placeholder, type, helperText }) => (
            <div key={name} className="space-y-1.5">
              <Label className="text-xs text-text-secondary dark:text-text-dark-secondary">
                {label}
              </Label>
              <Input
                type={type}
                value={values[name]}
                onChange={(e) => handleChange(name, e.target.value)}
                placeholder={placeholder}
                autoComplete={
                  name === 'email'
                    ? 'email'
                    : name === 'username'
                      ? 'username'
                      : name === 'password'
                        ? 'new-password'
                        : 'new-password'
                }
                hasError={Boolean(errors?.[name])}
              />
              <FieldMessage>{helperText}</FieldMessage>
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
          loadingText="Creating account..."
          loadingIcon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
        >
          <span>Get Started</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </form>

      <div className="pt-4 text-center">
        <Button type="button" variant="link" className="text-xs" onClick={() => navigate('/login')}>
          Already have an account? Sign in
        </Button>
      </div>
    </SignupPageLayout>
  );
}
