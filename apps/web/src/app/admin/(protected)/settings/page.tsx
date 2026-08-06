'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { format } from 'date-fns';
import { Loader2, ShieldOff, UserPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SortableTableHead } from '@/components/shared/sortable-table-head';
import { TablePagination } from '@/components/shared/table-pagination';
import { useAuditLogs, type AuditLog } from '@/hooks/use-audit-logs';
import { useCreateUser, useDeactivateUser, useUsers } from '@/hooks/use-users';
import { usePagination } from '@/hooks/use-pagination';
import { useSortableData } from '@/hooks/use-sortable-data';
import { useAuthStore } from '@/stores/auth-store';
import type { RoleName } from '@/types/domain';

type AuditLogSortKey = 'time' | 'actor' | 'action';

function getAuditLogSortValue(log: AuditLog, key: AuditLogSortKey) {
  switch (key) {
    case 'time':
      return new Date(log.createdAt).getTime();
    case 'actor':
      return log.actor?.fullName ?? 'System';
    case 'action':
      return log.action;
  }
}

const ROLE_OPTIONS: { value: RoleName; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'agency_operator', label: 'Agency Operator' },
  { value: 'analyst', label: 'Analyst' },
  { value: 'field_reporter', label: 'Field Reporter' },
];

const ROLE_LABELS: Record<RoleName, string> = {
  admin: 'Admin',
  agency_operator: 'Agency Operator',
  analyst: 'Analyst',
  field_reporter: 'Field Reporter',
};

const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1, 'Required'),
  password: z.string().min(8, 'At least 8 characters'),
  role: z.enum(['admin', 'agency_operator', 'analyst', 'field_reporter']),
});

type CreateUserValues = z.infer<typeof createUserSchema>;

function CreateUserDialog() {
  const [open, setOpen] = useState(false);
  const createUser = useCreateUser();
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { role: 'analyst' },
  });

  const onSubmit = (values: CreateUserValues) => {
    createUser.mutate(values, {
      onSuccess: () => {
        toast.success('User created successfully');
        reset();
        setOpen(false);
      },
      onError: () => toast.error('Failed to create user (email may already be registered)'),
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <UserPlus className="mr-2 h-4 w-4" /> New user
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>Add a new analyst/agency staff account.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input id="fullName" {...register('fullName')} />
            {errors.fullName && <p className="text-sm text-destructive">{errors.fullName.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...register('email')} />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Temporary password</Label>
            <Input id="password" type="password" {...register('password')} />
            {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={watch('role')} onValueChange={(v) => v && setValue('role', v as RoleName)}>
              <SelectTrigger>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createUser.isPending}>
              {createUser.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UsersTab() {
  const { data, isLoading } = useUsers();
  const deactivate = useDeactivateUser();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Users</CardTitle>
        <CreateUserDialog />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading &&
              data?.data.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.fullName}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>{ROLE_LABELS[u.role]}</TableCell>
                  <TableCell>
                    <Badge variant={u.isActive === false ? 'destructive' : 'outline'}>
                      {u.isActive === false ? 'Inactive' : 'Active'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => deactivate.mutate(u.id)}
                      title="Deactivate user"
                    >
                      <ShieldOff className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AuditLogTab() {
  const { data, isLoading } = useAuditLogs();

  const { sorted, sortKey, sortDirection, toggleSort } = useSortableData<AuditLog, AuditLogSortKey>(
    data?.data ?? [],
    getAuditLogSortValue,
    { key: 'time', direction: 'desc' },
  );
  const { pageData, page, pageCount, setPage, canPrev, canNext, total } = usePagination(sorted, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit Log</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableTableHead
                sortKey="time"
                label="Time"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={toggleSort}
              />
              <SortableTableHead
                sortKey="actor"
                label="Actor"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={toggleSort}
              />
              <SortableTableHead
                sortKey="action"
                label="Action"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={toggleSort}
              />
              <TableHead>Target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading &&
              pageData.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(log.createdAt), 'dd MMM yyyy HH:mm')}
                  </TableCell>
                  <TableCell>{log.actor?.fullName ?? 'System'}</TableCell>
                  <TableCell className="font-mono text-xs">{log.action}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {log.targetType ? `${log.targetType} · ${log.targetId?.slice(0, 8)}` : '—'}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        <TablePagination
          page={page}
          pageCount={pageCount}
          total={total}
          canPrev={canPrev}
          canNext={canNext}
          onPageChange={setPage}
        />
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const user = useAuthStore((state) => state.user);

  if (user && user.role !== 'admin') {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Settings are available to administrators only.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage users and monitor system activity.</p>
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4">
          <UsersTab />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditLogTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
