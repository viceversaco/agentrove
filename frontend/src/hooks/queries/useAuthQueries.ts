import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationOptions, UseQueryOptions } from '@tanstack/react-query';
import { authService } from '@/services/authService';
import type { AuthResponse, User, UserUsage } from '@/types/user.types';
import { queryKeys } from './queryKeys';

export const useCurrentUserQuery = (options?: Partial<UseQueryOptions<User>>) => {
  return useQuery({
    queryKey: [queryKeys.auth.user],
    queryFn: () => authService.getCurrentUser(),
    retry: false,
    ...options,
  });
};

export const useUserUsageQuery = (options?: Partial<UseQueryOptions<UserUsage>>) => {
  return useQuery({
    queryKey: [queryKeys.auth.usage],
    queryFn: () => authService.getUserUsage(),
    retry: false,
    ...options,
  });
};

interface LoginData {
  username: string;
  password: string;
}

export const useLoginMutation = (options?: UseMutationOptions<AuthResponse, Error, LoginData>) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: (data: LoginData) => authService.login(data),
    onSuccess: async (response, variables, context, mutation) => {
      await queryClient.cancelQueries();
      queryClient.clear();
      if (onSuccess) {
        await onSuccess(response, variables, context, mutation);
      }
    },
    ...restOptions,
  });
};

interface SignupData {
  email: string;
  username: string;
  password: string;
}

export const useSignupMutation = (options?: UseMutationOptions<User, Error, SignupData>) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: (data: SignupData) => authService.signup(data),
    onSuccess: async (response, variables, context, mutation) => {
      const needsVerification = response.email_verification_required && !response.is_verified;
      if (!needsVerification && authService.isAuthenticated()) {
        await queryClient.cancelQueries();
        queryClient.clear();
      }
      if (onSuccess) {
        await onSuccess(response, variables, context, mutation);
      }
    },
    ...restOptions,
  });
};

interface VerifyEmailData {
  token: string;
}

interface ResendVerificationData {
  email: string;
}

interface ForgotPasswordData {
  email: string;
}

interface ResetPasswordData {
  token: string;
  password: string;
}

export const useVerifyEmailMutation = (
  options?: UseMutationOptions<User, Error, VerifyEmailData>,
) => {
  return useMutation({
    mutationFn: (data: VerifyEmailData) => authService.verifyEmail(data),
    ...options,
  });
};

export const useResendVerificationMutation = (
  options?: UseMutationOptions<void, Error, ResendVerificationData>,
) => {
  return useMutation({
    mutationFn: (data: ResendVerificationData) => authService.resendVerification(data),
    ...options,
  });
};

export const useForgotPasswordMutation = (
  options?: UseMutationOptions<void, Error, ForgotPasswordData>,
) => {
  return useMutation({
    mutationFn: (data: ForgotPasswordData) => authService.forgotPassword(data),
    ...options,
  });
};

export const useResetPasswordMutation = (
  options?: UseMutationOptions<void, Error, ResetPasswordData>,
) => {
  return useMutation({
    mutationFn: (data: ResetPasswordData) => authService.resetPassword(data),
    ...options,
  });
};

export const useLogoutMutation = (options?: UseMutationOptions<void, Error, void>) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: async () => {
      await authService.logout();
    },
    onSuccess: async (response, variables, context, mutation) => {
      await queryClient.cancelQueries();
      queryClient.clear();
      if (onSuccess) {
        await onSuccess(response, variables, context, mutation);
      }
    },
    ...restOptions,
  });
};
