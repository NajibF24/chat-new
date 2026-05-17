import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import BotAvatar from './BotAvatar';

describe('BotAvatar Component', () => {
  it('renders default emoji when bot has no avatar data', () => {
    const { getByText } = render(<BotAvatar bot={{}} />);
    expect(getByText('🤖')).toBeInTheDocument();
  });

  it('renders specific emoji when avatar type is emoji', () => {
    const bot = {
      avatar: {
        type: 'emoji',
        emoji: '🌟',
      },
    };
    const { getByText } = render(<BotAvatar bot={bot} />);
    expect(getByText('🌟')).toBeInTheDocument();
  });
});
