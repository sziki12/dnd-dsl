import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

export const isLoopback = (address: string | undefined): boolean =>
    address !== undefined && (address === '::1' || /^(::ffff:)?127\./.test(address));

/**
 * For the requests that look at or change the server machine's own folders: other devices on the network
 * can use the app, but only the computer the server runs on may do these.
 */
@Injectable()
export class LoopbackGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const address = context.switchToHttp().getRequest().socket?.remoteAddress as string | undefined;
        if (!isLoopback(address)) throw new ForbiddenException('Only the computer the server runs on can do this.');
        return true;
    }
}
