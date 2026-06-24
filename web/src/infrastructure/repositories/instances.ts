import {
  HttpAuthRepository,
  HttpGroupRepository,
  HttpExamRepository,
  HttpNoticeRepository,
  HttpMessageRepository,
  HttpModerationRepository,
  HttpImpersonationRepository,
  HttpClassRepository,
  HttpAdminRepository,
  HttpAuthorizedEmailRepository,
  HttpAcademicCycleRepository,
  HttpProfileRepository,
} from './HttpRepositories';
import { LoginUseCase } from '../../application/useCases/LoginUseCase';
import { ManageExamsUseCase } from '../../application/useCases/ManageExamsUseCase';
import { ManageNoticesUseCase } from '../../application/useCases/ManageNoticesUseCase';
import { ManageMessagesUseCase } from '../../application/useCases/ManageMessagesUseCase';
import { ImpersonateStudentUseCase } from '../../application/useCases/ImpersonateStudentUseCase';

// Singleton Repository Instances
export const authRepository = new HttpAuthRepository();
export const groupRepository = new HttpGroupRepository();
export const examRepository = new HttpExamRepository();
export const noticeRepository = new HttpNoticeRepository();
export const messageRepository = new HttpMessageRepository();
export const moderationRepository = new HttpModerationRepository();
export const impersonationRepository = new HttpImpersonationRepository();
export const classRepository = new HttpClassRepository();
export const adminRepository = new HttpAdminRepository();
export const authorizedEmailRepository = new HttpAuthorizedEmailRepository();
export const academicCycleRepository = new HttpAcademicCycleRepository();
export const profileRepository = new HttpProfileRepository();

// Use Case Instances
export const loginUseCase = new LoginUseCase(authRepository);
export const manageExamsUseCase = new ManageExamsUseCase(examRepository, groupRepository);
export const manageNoticesUseCase = new ManageNoticesUseCase(noticeRepository);
export const manageMessagesUseCase = new ManageMessagesUseCase(messageRepository);
export const impersonateStudentUseCase = new ImpersonateStudentUseCase(impersonationRepository);
