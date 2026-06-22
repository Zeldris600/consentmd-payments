import {
  Body,
  Controller,
  Get,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DevAuthService } from './dev-auth.service';
import { DevLoginDto } from './dto/dev-login.dto';
import { DevOnlyGuard } from './guards/dev-only.guard';
import { BearerToken } from './current-user.decorator';

@ApiTags('dev-auth')
@Controller('dev/auth')
@UseGuards(DevOnlyGuard)
export class DevAuthController {
  constructor(private readonly devAuthService: DevAuthService) {}

  @Post('login')
  @ApiOperation({
    summary: 'Login via Laravel IdP (DEV only)',
    description:
      'Proxies email/password to Laravel `POST /api/auth/email-login`. ' +
      'Returns `{ access_token, user }` (user fields are not duplicated at the top level). ' +
      'Paste `access_token` into Swagger **Authorize**. DEV only.',
  })
  async login(
    @Body() dto: DevLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data, status } = await this.devAuthService.login(dto);
    res.status(status);
    return data;
  }

  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Verify bearer token against IdP (DEV only)',
    description:
      'Calls Laravel `GET /api/auth/me` with the supplied bearer token.',
  })
  async me(@BearerToken() bearerToken?: string) {
    if (!bearerToken) {
      throw new UnauthorizedException('Missing Authorization: Bearer <token>');
    }
    return this.devAuthService.getMe(bearerToken);
  }
}
