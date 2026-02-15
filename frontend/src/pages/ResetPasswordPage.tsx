import { memo, type ReactNode, useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, ArrowLeft, Lock, ArrowRight, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { Layout } from '@/components/layout';
import { Button } from '@/components/ui/primitives/Button';
import { FieldMessage } from '@/components/ui/primitives/FieldMessage';
import { Input } from '@/components/ui/primitives/Input';
import { Label } from '@/components/ui/primitives/Label';
import { useResetPasswordMutation } from '@/hooks/queries/useAuthQueries';
import { isValidPassword } from '@/utils/validation';

interface ResetPasswordFormData {
  password: string;
  confirmPassword: string;
}

type ResetPasswordFormErrors = Partial<Record<keyof ResetPasswordFormData, string>>;

interface ResetPasswordPageLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

const ResetPasswordPageLayout = memo(function ResetPasswordPageLayout({
  title,
  subtitle,
  children,
}: ResetPasswordPageLayoutProps) {
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

const validateForm = (values: ResetPasswordFormData): ResetPasswordFormErrors | null => {
  const errors: ResetPasswordFormErrors = {};

  if (!values.password) {
    errors.password = 'Password is required';
  } else if (!isValidPassword(values.password)) {
    errors.password = 'Password must be at least 8 characters';
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = 'Please confirm your password';
  } else if (values.password !== values.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match';
  }

  return Object.keys(errors).length ? errors : null;
};

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [values, setValues] = useState<ResetPasswordFormData>({
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<ResetPasswordFormErrors | null>(null);
  const [visibleFields, setVisibleFields] = useState<Record<keyof ResetPasswordFormData, boolean>>({
    password: false,
    confirmPassword: false,
  });
  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const resetPasswordMutation = useResetPasswordMutation();

  useEffect(() => {
    const tokenParam = searchParams.get('token');
    if (!tokenParam) {
      setTokenError('Invalid or missing reset token');
      return;
    }
    setToken(tokenParam);
  }, [searchParams]);

  const handleChange = useCallback(
    (name: keyof ResetPasswordFormData, value: string) => {
      setValues((prev) => ({ ...prev, [name]: value }));
      setErrors((prev) => {
        if (!prev?.[name]) {
          return prev;
        }

        const rest = { ...prev };
        delete rest[name];
        return Object.keys(rest).length ? rest : null;
      });
      resetPasswordMutation.reset();
    },
    [resetPasswordMutation],
  );

  const toggleFieldVisibility = useCallback((field: keyof ResetPasswordFormData) => {
    setVisibleFields((prev) => ({ ...prev, [field]: !prev[field] }));
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      if (!token) {
        setTokenError('Invalid or missing reset token');
        return;
      }

      const validationErrors = validateForm(values);
      if (validationErrors) {
        setErrors(validationErrors);
        return;
      }

      setErrors(null);
      const attemptValues = { ...values };

      resetPasswordMutation.mutate({
        token,
        password: attemptValues.password,
      });
    },
    [resetPasswordMutation, token, values],
  );

  const fieldConfigs = useMemo(
    () => [
      {
        name: 'password' as const,
        label: 'New Password',
        placeholder: 'Enter new password (min. 8 characters)',
      },
      {
        name: 'confirmPassword' as const,
        label: 'Confirm Password',
        placeholder: 'Confirm your new password',
      },
    ],
    [],
  );

  const isSubmitting = resetPasswordMutation.isPending;

  if (!token && !tokenError) {
    return (
      <ResetPasswordPageLayout title="Loading..." subtitle="Validating reset token">
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-text-quaternary dark:text-text-dark-quaternary" />
        </div>
      </ResetPasswordPageLayout>
    );
  }

  if (resetPasswordMutation.isSuccess) {
    return (
      <ResetPasswordPageLayout title="Password Reset" subtitle="Your password has been updated">
        <div className="space-y-4 text-center">
          <div className="rounded-lg border border-border/50 bg-surface-hover/50 p-4 dark:border-border-dark/50 dark:bg-surface-dark-hover/50">
            <CheckCircle className="mx-auto mb-2 h-5 w-5 text-text-primary dark:text-text-dark-primary" />
            <p className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
              Password has been reset successfully!
            </p>
          </div>

          <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
            You can now log in with your new password.
          </p>

          <Button onClick={() => navigate('/login')} variant="primary" size="lg" className="w-full">
            <span>Sign In</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </ResetPasswordPageLayout>
    );
  }

  const title = 'Reset Password';
  const subtitle = 'Enter your new password';

  return (
    <ResetPasswordPageLayout title={title} subtitle={subtitle}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {(tokenError || resetPasswordMutation.error) && (
          <div className="animate-fadeIn rounded-lg border border-error-500/20 bg-error-500/10 p-3">
            <p className="text-xs font-medium text-error-600 dark:text-error-400">
              {tokenError || resetPasswordMutation.error?.message}
            </p>
            {(tokenError?.includes('token') ||
              resetPasswordMutation.error?.message?.includes('token')) && (
              <div className="mt-2">
                <Button
                  type="button"
                  variant="link"
                  className="text-xs text-error-600 hover:text-error-500 dark:text-error-400 dark:hover:text-error-300"
                  onClick={() => navigate('/forgot-password')}
                >
                  Request a new reset link
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3.5">
          {fieldConfigs.map(({ name, label, placeholder }) => (
            <div key={name} className="space-y-1.5">
              <Label className="text-xs text-text-secondary dark:text-text-dark-secondary">
                {label}
              </Label>
              <div className="relative">
                <Input
                  type={visibleFields[name] ? 'text' : 'password'}
                  value={values[name]}
                  onChange={(e) => handleChange(name, e.target.value)}
                  placeholder={placeholder}
                  autoComplete="new-password"
                  hasError={Boolean(errors?.[name])}
                  className="pr-10"
                />
                <Button
                  type="button"
                  onClick={() => toggleFieldVisibility(name)}
                  variant="ghost"
                  size="icon"
                  className="absolute right-1.5 top-1/2 h-7 w-7 -translate-y-1/2 text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                >
                  {visibleFields[name] ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
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
          loadingText="Resetting..."
          loadingIcon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
          disabled={!token || isSubmitting}
        >
          <Lock className="h-3.5 w-3.5" />
          <span>Reset Password</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </form>

      <div className="pt-4 text-center">
        <Button
          type="button"
          variant="link"
          className="inline-flex items-center gap-1 text-xs"
          onClick={() => navigate('/login')}
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Sign in
        </Button>
      </div>
    </ResetPasswordPageLayout>
  );
}
