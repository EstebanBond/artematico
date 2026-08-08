export class AuthError extends Error {}

interface GraphqlErrorEntry {
  message: string;
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: GraphqlErrorEntry[];
}

export async function graphqlRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch('/graphql', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) {
    throw new AuthError('No autenticado');
  }
  const json = (await res.json()) as GraphqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors[0].message);
  }
  return json.data as T;
}
