import { AuthData, AuthUser } from "./auth-store"
import { BrowserWindow } from "electron"

// Hardcoded local user — no remote auth
const LOCAL_USER: AuthUser = {
  id: "user@local",
  email: "user@local",
  name: "Local User",
  imageUrl: null,
  username: "local",
}

export class AuthManager {
  verifyAndConsumeAuthState(_incomingState: string | null): boolean { return false }
  setOnTokenRefresh(_callback: (authData: AuthData) => void): void {}
  async exchangeCode(_code: string): Promise<AuthData> { throw new Error("Not supported in offline mode") }
  async getValidToken(): Promise<string | null> { return null }
  async refresh(): Promise<boolean> { return false }
  isAuthenticated(): boolean { return true }
  getUser(): AuthUser | null { return LOCAL_USER }
  getAuth(): AuthData | null { return null }
  logout(): void {}
  startAuthFlow(_mainWindow: BrowserWindow | null): void {}
  async updateUser(_updates: { name?: string }): Promise<AuthUser | null> { return LOCAL_USER }
  async fetchUserPlan(): Promise<{ email: string; plan: string; status: string | null } | null> { return null }
}

let authManagerInstance: AuthManager | null = null

export function initAuthManager(_isDev: boolean = false): AuthManager {
  if (!authManagerInstance) authManagerInstance = new AuthManager()
  return authManagerInstance
}

export function getAuthManager(): AuthManager {
  if (!authManagerInstance) authManagerInstance = new AuthManager()
  return authManagerInstance
}
