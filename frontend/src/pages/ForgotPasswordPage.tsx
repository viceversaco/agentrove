import { memo, type ReactNode, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ArrowLeft, Mail, ArrowRight, CheckCircle } from 'lucide-react';
import { Layout } from '@/components/layout';
import { Button } from '@/components/ui/primitives/Button';
import { FieldMessage } from '@/components/ui/primitives/FieldMessage';
import { Input } from '@/components/ui/primitives/Input';
import { Label } from '@/components/ui/primitives/Label';
import { useForgotPasswordMutation } from '@/hooks/queries/useAuthQueries';
import { isValidEmail } from '@/utils/validation';

interface ForgotPasswordFormData {
  email: string;
}

type ForgotPasswordFormErrors = Partial<Record<keyof ForgotPasswordFormData, string>>;

interface ForgotPasswordPageLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

const ForgotPasswordPageLayout = memo(function ForgotPasswordPageLayout({
  title,
  subtitle,
  children,
}: ForgotPasswordPageLayoutProps) {
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

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [values, setValues] = useState<ForgotPasswordFormData>({ email: '' });
  const [errors, setErrors] = useState<ForgotPasswordFormErrors | null>(null);

  const forgotPasswordMutation = useForgotPasswordMutation();

  const validators = useMemo(
    () => ({
      email: (value: string): string | undefined => {
        const trimmed = value.trim();
        if (!trimmed) return 'Email is required';
        if (!isValidEmail(trimmed)) return 'Invalid email address';
        return undefined;
      },
    }),
    [],
  );

  const validateForm = useCallback(
    (data: ForgotPasswordFormData): ForgotPasswordFormErrors => {
      const nextErrors: ForgotPasswordFormErrors = {};
      (Object.keys(validators) as Array<keyof ForgotPasswordFormData>).forEach((key) => {
        const validator = validators[key];
        const error = validator(data[key]);
        if (error) {
          nextErrors[key] = error;
        }
      });
      return nextErrors;
    },
    [validators],
  );

  const handleChange = useCallback(
    (name: keyof ForgotPasswordFormData, value: string) => {
      setValues((prev) => ({ ...prev, [name]: value }));

      if (errors?.[name]) {
        setErrors((prev) => {
          if (!prev) return prev;
          const rest = { ...prev };
          delete rest[name];
          return Object.keys(rest).length ? rest : null;
        });
      }

      if (forgotPasswordMutation.isError) {
        forgotPasswordMutation.reset();
      }
    },
    [errors, forgotPasswordMutation],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const validationErrors = validateForm(values);
      if (Object.keys(validationErrors).length) {
        setErrors(validationErrors);
        return;
      }

      setErrors(null);
      forgotPasswordMutation.mutate({ email: values.email.trim() });
    },
    [forgotPasswordMutation, validateForm, values],
  );

  if (forgotPasswordMutation.isSuccess) {
    return (
      <Layout isAuthPage={true}>
        <div className="flex h-full flex-col bg-surface-secondary dark:bg-surface-dark-secondary">
          <div className="flex flex-1 flex-col items-center justify-center p-4">
            <div className="relative z-10 w-full max-w-sm space-y-5">
              <div className="flex justify-center">
                <CheckCircle className="h-6 w-6 text-text-primary dark:text-text-dark-primary" />
              </div>

              <div className="rounded-xl border border-border/50 bg-surface-tertiary p-6 shadow-medium dark:border-border-dark/50 dark:bg-surface-dark-tertiary">
                <div className="mb-5 space-y-1.5 text-center">
                  <h2 className="text-lg font-semibold text-text-primary dark:text-text-dark-primary">
                    Check Your Email
                  </h2>
                  <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                    We've sent a password reset link to your email
                  </p>
                </div>

                <div className="mb-5 rounded-lg border border-border/50 bg-surface-hover/50 p-3 dark:border-border-dark/50 dark:bg-surface-dark-hover/50">
                  <p className="text-xs text-text-secondary dark:text-text-dark-secondary">
                    Check your email and follow the link to reset your password. The link will
                    expire in 24 hours.
                  </p>
                </div>

                <Button
                  onClick={() => navigate('/login')}
                  variant="primary"
                  size="lg"
                  className="w-full"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to Sign in
                </Button>
              </div>

              <p className="text-center text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                Can't find the email? Check your spam folder.
              </p>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const title = 'Forgot Password';
  const subtitle = 'Enter your email to receive a reset link';

  return (
    <ForgotPasswordPageLayout title={title} subtitle={subtitle}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {forgotPasswordMutation.error && (
          <div className="animate-fadeIn rounded-lg border border-error-500/20 bg-error-500/10 p-3">
            <p className="text-xs font-medium text-error-600 dark:text-error-400">
              {forgotPasswordMutation.error.message.includes('contact@claudex.pro') ? (
                <>
                  Email not found. Please check your email or contact support at{' '}
                  <a
                    href="mailto:contact@claudex.pro"
                    className="underline transition-colors hover:text-error-500 dark:hover:text-error-300"
                  >
                    contact@claudex.pro
                  </a>
                </>
              ) : (
                forgotPasswordMutation.error.message
              )}
            </p>
          </div>
        )}

        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label className="text-xs text-text-secondary dark:text-text-dark-secondary">
              Email address
            </Label>
            <Input
              type="email"
              value={values.email}
              onChange={(e) => handleChange('email', e.target.value)}
              placeholder="name@example.com"
              hasError={Boolean(errors?.email)}
            />
            <FieldMessage variant="error">{errors?.email}</FieldMessage>
          </div>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="mt-5 w-full"
          isLoading={forgotPasswordMutation.isPending}
          loadingText="Sending..."
          loadingIcon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
        >
          <Mail className="h-3.5 w-3.5" />
          <span>Send Reset Link</span>
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
    </ForgotPasswordPageLayout>
  );
}
