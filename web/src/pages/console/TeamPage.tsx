import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { Modal } from '../../components/overlay';
import { Avatar, ErrorNote, Skeleton } from '../../components/ui';
import type { Role, User } from '../../types';

export function TeamPage() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/v1/users', { auth: true }) });
  const [adding, setAdding] = useState(false);

  const toggle = useMutation({
    mutationFn: (u: User) =>
      api<User>(`/v1/users/${u.id}/active`, { method: 'PATCH', auth: true, body: { isActive: !u.isActive } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Team</h1>
          <p>Who can sign in to the console.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" /> Add user
        </button>
      </header>

      <ErrorNote error={users.error ?? toggle.error} />
      {users.isPending && <Skeleton height={240} />}
      {users.data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <Avatar name={u.fullName} size={34} />
                      <strong style={{ fontWeight: 500 }}>{u.fullName}</strong>
                    </div>
                  </td>
                  <td className="muted">{u.email}</td>
                  <td>
                    <span className="chip">{u.role === 'admin' ? 'Admin' : 'Recruiter'}</span>
                  </td>
                  <td>{u.isActive ? <span className="badge badge-open">Active</span> : <span className="badge badge-closed">Deactivated</span>}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => toggle.mutate(u)} aria-label={`${u.isActive ? 'Deactivate' : 'Reactivate'} ${u.fullName}`}>
                      {u.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && <AddUser onClose={() => setAdding(false)} />}
    </>
  );
}

function AddUser({ onClose }: { onClose(): void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('recruiter');

  const create = useMutation({
    mutationFn: () => api<User>('/v1/users', { method: 'POST', auth: true, body: { email, fullName, password, role } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Modal
      title="Add a user"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="user-form" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Adding...' : 'Add user'}
          </button>
        </>
      }
    >
      <form id="user-form" className="stack" onSubmit={submit}>
        <div className="grid-2">
          <label className="field">
            <span>Full name</span>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span>Password (12+ characters)</span>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} autoComplete="new-password" />
          </label>
          <label className="field">
            <span>Role</span>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="recruiter">Recruiter</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>
        <ErrorNote error={create.error} />
      </form>
    </Modal>
  );
}
