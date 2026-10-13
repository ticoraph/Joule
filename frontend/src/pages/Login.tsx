import { useAuth } from "../hooks/useAuth";

export default function Login() {
  const { login } = useAuth();

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-4 rounded-lg border bg-white p-10 shadow-sm">
        <h1 className="text-xl font-bold">Joule</h1>
        <button
          onClick={login}
          className="rounded bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700"
        >
          Se connecter avec Google
        </button>
      </div>
    </div>
  );
}
