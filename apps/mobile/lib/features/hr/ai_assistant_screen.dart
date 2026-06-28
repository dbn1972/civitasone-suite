import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// AI HR Assistant — natural language queries for HR info.
/// POST /v1/hrms/assistant { message }
class AiAssistantScreen extends ConsumerStatefulWidget {
  const AiAssistantScreen({super.key});

  @override
  ConsumerState<AiAssistantScreen> createState() => _AiAssistantScreenState();
}

class _AiAssistantScreenState extends ConsumerState<AiAssistantScreen> {
  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  final List<_ChatMessage> _messages = [];
  bool _sending = false;

  static const _suggestions = [
    'How much casual leave do I have?',
    'When is the next holiday?',
    'Show my payslip',
    'Who is my reporting manager?',
    'What is the leave policy?',
    'My loan status',
  ];

  @override
  void initState() {
    super.initState();
    _messages.add(_ChatMessage(
      isBot: true,
      text: "Hello! 👋 I'm your HR assistant. Ask me about:\n\n"
          "• Leave balance\n"
          "• Payslip info\n"
          "• Upcoming holidays\n"
          "• Attendance status\n"
          "• Reporting manager\n"
          "• HR policies\n"
          "• Loan/advance status\n\n"
          "Just type or tap a suggestion below!",
    ));
  }

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _send(String text) async {
    if (text.trim().isEmpty) return;
    setState(() {
      _messages.add(_ChatMessage(isBot: false, text: text.trim()));
      _sending = true;
    });
    _controller.clear();
    _scrollToBottom();

    try {
      final apiClient = ref.read(apiClientProvider);
      final res = await apiClient.post<Map<String, dynamic>>(
        '/v1/hrms/assistant',
        data: {'message': text.trim()},
      );
      final reply = res.data?['text'] as String? ?? "I'm not sure how to help with that.";
      final action = res.data?['action'] as String?;

      setState(() {
        _messages.add(_ChatMessage(isBot: true, text: reply, action: action));
      });
    } catch (e) {
      setState(() {
        _messages.add(_ChatMessage(isBot: true, text: "Sorry, I couldn't process that. Please try again."));
      });
    } finally {
      if (mounted) setState(() => _sending = false);
      _scrollToBottom();
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Row(children: [
          Icon(Icons.smart_toy, size: 22, color: theme.colorScheme.primary),
          const SizedBox(width: 8),
          const Text('HR Assistant'),
        ]),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: 'Clear chat',
            onPressed: () => setState(() {
              _messages.clear();
              _messages.add(_ChatMessage(isBot: true, text: "Chat cleared. How can I help you?"));
            }),
          ),
        ],
      ),
      body: Column(children: [
        // Messages
        Expanded(
          child: ListView.builder(
            controller: _scrollController,
            padding: const EdgeInsets.all(16),
            itemCount: _messages.length + (_sending ? 1 : 0),
            itemBuilder: (_, i) {
              if (i == _messages.length) {
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Row(children: [
                    const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                    const SizedBox(width: 12),
                    Text('Thinking…', style: TextStyle(color: theme.colorScheme.outline, fontSize: 13)),
                  ]),
                );
              }
              return _MessageBubble(message: _messages[i]);
            },
          ),
        ),

        // Suggestions (only show if few messages)
        if (_messages.length <= 2)
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: _suggestions.map((s) => Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ActionChip(
                  label: Text(s, style: const TextStyle(fontSize: 12)),
                  onPressed: () => _send(s),
                  backgroundColor: theme.colorScheme.primary.withOpacity(0.05),
                ),
              )).toList(),
            ),
          ),

        // Input
        Container(
          padding: const EdgeInsets.fromLTRB(16, 8, 8, 16),
          decoration: BoxDecoration(
            color: theme.colorScheme.surface,
            border: Border(top: BorderSide(color: theme.colorScheme.outlineVariant)),
          ),
          child: SafeArea(
            top: false,
            child: Row(children: [
              Expanded(
                child: TextField(
                  controller: _controller,
                  decoration: InputDecoration(
                    hintText: 'Ask anything about HR…',
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(24)),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    isDense: true,
                  ),
                  textInputAction: TextInputAction.send,
                  onSubmitted: _send,
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: _sending ? null : () => _send(_controller.text),
                style: FilledButton.styleFrom(
                  shape: const CircleBorder(),
                  padding: const EdgeInsets.all(12),
                ),
                child: const Icon(Icons.send, size: 20),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}

class _ChatMessage {
  final bool isBot;
  final String text;
  final String? action;
  _ChatMessage({required this.isBot, required this.text, this.action});
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});
  final _ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isBot = message.isBot;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment: isBot ? MainAxisAlignment.start : MainAxisAlignment.end,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (isBot) ...[
            Container(
              width: 32, height: 32,
              decoration: BoxDecoration(
                color: theme.colorScheme.primary.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.smart_toy, size: 18, color: theme.colorScheme.primary),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: isBot
                    ? theme.colorScheme.surfaceContainerLow
                    : theme.colorScheme.primary,
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(16),
                  topRight: const Radius.circular(16),
                  bottomLeft: Radius.circular(isBot ? 4 : 16),
                  bottomRight: Radius.circular(isBot ? 16 : 4),
                ),
              ),
              child: Text(
                message.text,
                style: TextStyle(
                  color: isBot ? theme.colorScheme.onSurface : theme.colorScheme.onPrimary,
                  fontSize: 14,
                ),
              ),
            ),
          ),
          if (!isBot) const SizedBox(width: 40),
        ],
      ),
    );
  }
}
