import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { ErrorNote } from '../components/badges';
import type { Role, User } from '../types';

export function UsersPage() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/v1/users', { auth: true }) });
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('recruiter');

  const create = useMutation({
    mutationFn: () => api<User>('/v1/users', { method: 'POST', auth: true, body: { email, fullName, password, role } }),
    onSuccess: () => {
      setEmail('');
      setFullName('');
      setPassword('');
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const toggle = useMutation({
    mutationFn: (u: User) =>
      api<User>(`/v1/users/${u.id}/active`, { method: 'PATCH', auth: true, body: { isActive: !u.isActive } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <section>
      <h1>Users</h1>
      <ErrorNote error={users.error ?? toggle.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.data?.map((u) => (
              <tr key={u.id}>
                <td>{u.fullName}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{u.isActive ? 'yes' : 'no'}</td>
                <td>
                  <button className="link" onClick={() => toggle.mutate(u)}>
                    {u.isActive ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="panel" onSubmit={submit}>
        <h2>Add a user</h2>
        <div className="grid2">
          <label>
            Full name
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password (12+ characters)
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="recruiter">Recruiter</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>
        <ErrorNote error={create.error} />
        <button type="submit" disabled={create.isPending}>
          Add user
        </button>
      </form>
    </section>
  );
}
