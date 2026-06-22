import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class DevLoginDto {
  @ApiProperty({
    description: 'Laravel IdP user email',
    example: 'admin@consentmd-demo.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'Password forwarded to Laravel `POST /api/auth/email-login`.',
    example: 'password',
  })
  @IsString()
  @IsNotEmpty()
  password: string;
}
